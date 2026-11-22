"""Account-owned device authorization and planner-only Codex turns."""
from contextlib import contextmanager
from dataclasses import dataclass, field
import json
import logging
import re
from queue import Empty
from sqlalchemy.exc import SQLAlchemyError
from threading import Event, Lock, Thread
from time import monotonic
from urllib.parse import urlsplit
from uuid import uuid4

from app.db import stored_session
from .adapters import Call, ProviderError
from .codex_runtime import ERROR, runtime
from .models import AIProvider
from .providers import apply_catalog
from .secrets import seal, unseal


@dataclass
class Login:
    ready: Event = field(default_factory=Event)
    state: str = "starting"
    url: str = ""
    code: str = ""
    reason: str = ""


# The application runs a single ASGI worker. Only transient authorization prompts live in memory.
sessions = {}
guard = Lock()
account_locks = [Lock() for _ in range(64)]


def account_lock(directory):
    return account_locks[hash(directory) % len(account_locks)]


def public(login):
    if login.state == "failed":
        return {"state": "failed", "reason": login.reason}
    return {"state": login.state, **({"verification_url": login.url, "user_code": login.code}
                                    if login.state == "pending" else {})}


def status(directory, *, saved=False):
    with guard:
        login = sessions.get(directory)
        if saved and (not login or login.state != "syncing_models"):
            return {"state": "connected"}
        return public(login) if login else {"state": "idle"}


def start(directory):
    with guard:
        current = sessions.get(directory)
        if not current or current.state not in {"starting", "pending", "syncing_models"}:
            current = sessions[directory] = Login()
            Thread(target=authorize, args=(directory, current), daemon=True).start()
    current.ready.wait(12)
    return status(directory)


def authorize(directory, login):
    stage = "device_start"
    try:
        with runtime() as rpc:
            flow = rpc.call("account/login/start", {"type": "chatgptDeviceCode"})
            url = urlsplit(flow["verificationUrl"])
            if not (url.scheme == "https" and url.hostname in {"auth.openai.com", "chatgpt.com", "openai.com"}
                    and not url.username and not url.password and url.port in {None, 443}
                    and re.fullmatch(r"[A-Za-z0-9 -]{4,32}", flow["userCode"])):
                raise ProviderError(ERROR)
            with guard:
                if sessions.get(directory) is not login:
                    return
                login.state, login.url, login.code = "pending", flow["verificationUrl"], flow["userCode"]
                login.ready.set()
            stage = "device_exchange"
            deadline = monotonic() + 15 * 60
            while monotonic() < deadline:
                with guard:
                    if sessions.get(directory) is not login:
                        return
                # Short waits allow a cancelled prompt to release its subprocess.
                try:
                    msg = rpc.notifications.pop(0) if rpc.notifications else rpc.messages.get(timeout=1)
                except Empty:
                    continue
                if msg is None:
                    raise ProviderError(ERROR)
                if msg.get("method") != "account/login/completed":
                    continue
                event = msg["params"]
                # The protocol permits an omitted ID. This private runtime owns one login.
                if event.get("loginId") not in (None, flow["loginId"]):
                    continue
                if not event["success"]:
                    detail = str(event.get("error") or "").lower()
                    if "expired" in detail:
                        stage = "expired"
                    elif re.search(r"\b403\b|forbidden", detail):
                        stage = "exchange_forbidden"
                    raise ProviderError(ERROR)
                stage = "save_grant"
                # Only the official CLI writes to this fresh, per-flow credential store.
                grant = rpc.auth_file.read_text(encoding="utf-8")
                parsed = json.loads(grant)
                tokens = parsed.get("tokens") if isinstance(parsed, dict) else None
                if not isinstance(tokens, dict) or not tokens.get("access_token"):
                    raise ProviderError(ERROR)
                with account_lock(directory), guard:
                    if sessions.get(directory) is not login:
                        return
                    with stored_session(directory) as db, db.begin():
                        row = db.get(AIProvider, "codex")
                        row.secret, row.status, row.detail = seal(grant), "connected", ""
                    login.state = "syncing_models"
                stage = "models"
                catalog = rpc.models()
                with account_lock(directory), guard:
                    if sessions.get(directory) is not login:
                        return
                    with stored_session(directory) as db, db.begin():
                        apply_catalog(db.get(AIProvider, "codex"), catalog)
                    login.state = "connected"
                return
            stage = "expired"
            raise ProviderError(ERROR)
    except (ProviderError, OSError, ValueError, KeyError, RuntimeError, SQLAlchemyError) as exc:
        # Upstream errors may contain tokens, device codes or account identifiers.
        logging.getLogger(__name__).warning("Codex device flow stage=%s error_type=%s", stage, type(exc).__name__)
        with guard:
            login.state = "connected" if stage == "models" else "failed"
            login.reason = stage
    finally:
        login.url = login.code = ""
        login.ready.set()


def disconnect(directory):
    with account_lock(directory), guard:
        sessions.pop(directory, None)
        with stored_session(directory) as db, db.begin():
            row = db.get(AIProvider, "codex")
            if row:
                row.secret, row.model, row.catalog, row.status, row.detail = None, "", [], "unconfigured", ""


@contextmanager
def signed_runtime(directory):
    with account_lock(directory):
        with stored_session(directory) as db:
            row = db.get(AIProvider, "codex")
            if not row or not row.enabled or not row.secret:
                raise ProviderError(ERROR)
            auth = unseal(row.secret)
        with runtime(auth) as rpc:
            try:
                yield rpc
            finally:
                updated = rpc.auth_file.read_text(encoding="utf-8")
                if updated != auth:
                    with stored_session(directory) as db, db.begin():
                        db.get(AIProvider, "codex").secret = seal(updated)


class CodexAdapter:
    def __init__(self, directory):
        self.directory = directory

    def list_models(self):
        with signed_runtime(self.directory) as rpc:
            return rpc.models()

    def stream(self, instructions, history, functions, model, reasoning, result):
        with signed_runtime(self.directory) as rpc:
            # No execution environment, host capability roots, MCP or client-provided tools.
            # DayWeave validates structured proposals and applies them to the active workspace.
            thread = rpc.call("thread/start", {"model": model, "cwd": str(rpc.cwd), "ephemeral": True,
                "approvalPolicy": "never", "sandbox": "read-only", "environments": [], "selectedCapabilityRoots": [],
                "baseInstructions": instructions + "\nOnly answer the planner request. Never access files or run commands.",
                "allowProviderModelFallback": False})
            prompt = json.dumps({"conversation": history}, ensure_ascii=False)
            params = {"threadId": thread["thread"]["id"], "input": [{"type": "text", "text": prompt}]}
            if reasoning and reasoning != "auto":
                params["effort"] = reasoning
            if functions:
                params["input"][0]["text"] += "\nChoose DayWeave actions using these definitions. Encode arguments as a JSON object string.\n" + json.dumps(functions, ensure_ascii=False)
                params["outputSchema"] = {
                    "type": "object", "properties": {"calls": {"type": "array", "items": {
                        "type": "object", "properties": {"name": {"type": "string", "enum": [f["name"] for f in functions]},
                        "arguments": {"type": "string"}}, "required": ["name", "arguments"], "additionalProperties": False}}},
                    "required": ["calls"], "additionalProperties": False}
            turn = rpc.call("turn/start", params)["turn"]["id"]
            text = ""
            for msg in rpc.events(monotonic() + 125):
                event = msg.get("params", {})
                if event.get("turnId", turn) != turn:
                    continue
                if msg.get("method") == "item/completed" and event["item"]["type"] == "agentMessage":
                    text = event["item"]["text"]
                if msg.get("method") == "turn/completed" and event["turn"]["id"] == turn:
                    if event["turn"]["status"] != "completed":
                        raise ProviderError(ERROR)
                    break
            if functions:
                for call in json.loads(text)["calls"]:
                    if call["name"] not in {f["name"] for f in functions} or not isinstance(json.loads(call["arguments"]), dict):
                        raise ProviderError(ERROR)
                    result.calls.append(Call(str(uuid4()), call["name"], call["arguments"]))
                result.wire.append({"role": "assistant", "content": text})
            else:
                result.text = text
                yield text

    def output(self, call, data):
        return {"role": "user", "content": json.dumps({"tool": call.name, "result": data}, ensure_ascii=False, default=str)}
