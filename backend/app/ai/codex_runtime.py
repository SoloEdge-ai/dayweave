"""Private stdio transport to the pinned official Codex App Server."""
import contextlib
import json
import os
from pathlib import Path
from queue import Empty, Queue
import subprocess
from tempfile import TemporaryDirectory
from threading import Thread
from time import monotonic

from .adapters import ProviderError

ERROR = "Codex 服务暂不可用，请检查连接或重新登录。"


class Runtime:
    def __init__(self, directory, auth=None):
        self.home = Path(directory) / "home"
        self.home.mkdir(mode=0o700)
        self.cwd = Path(directory) / "workspace"
        self.cwd.mkdir(mode=0o700)
        self.auth_file = self.home / "auth.json"
        if auth:
            self.auth_file.write_text(auth, encoding="utf-8")
            self.auth_file.chmod(0o600)
        env = {k: os.environ[k] for k in ("PATH", "SYSTEMROOT", "WINDIR", "SSL_CERT_FILE") if k in os.environ}
        env.update(HOME=str(self.home), USERPROFILE=str(self.home), CODEX_HOME=str(self.home),
                   TEMP=directory, TMP=directory, TMPDIR=directory)
        cmd = [os.getenv("DAYWEAVE_CODEX_BIN") or "codex", "app-server", "--listen", "stdio://", "--enable", "skip_host_skill_discovery",
               "-c", 'cli_auth_credentials_store="file"', "-c", 'web_search="disabled"']
        for feature in ("shell_tool", "unified_exec", "plugins", "multi_agent", "image_generation", "skill_search", "skill_mcp_dependency_install"):
            cmd.extend(["--disable", feature])
        self.proc = subprocess.Popen(cmd, env=env, cwd=self.cwd, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                     stderr=subprocess.DEVNULL, encoding="utf-8", errors="strict", bufsize=1)
        self.messages = Queue()
        self.notifications = []
        self.sequence = 0
        Thread(target=self._read, daemon=True).start()

    def _read(self):
        try:
            for line in self.proc.stdout:
                self.messages.put(json.loads(line))
        except (ValueError, OSError):
            pass
        finally:
            self.messages.put(None)

    def send(self, message):
        self.proc.stdin.write(json.dumps(message) + "\n")
        self.proc.stdin.flush()

    def receive(self, deadline):
        while True:
            try:
                msg = self.messages.get(timeout=max(0, deadline - monotonic()))
            except Empty:
                raise ProviderError(ERROR) from None
            if msg is None or monotonic() >= deadline:
                raise ProviderError(ERROR)
            if "method" in msg and "id" in msg:
                self.send({"id": msg["id"], "error": {"code": -32601, "message": "Unsupported client request"}})
                continue
            return msg

    def call(self, method, params):
        self.sequence += 1
        self.send({"id": self.sequence, "method": method, "params": params})
        deadline = monotonic() + 35
        while True:
            msg = self.receive(deadline)
            if msg.get("id") == self.sequence:
                if "error" in msg:
                    raise ProviderError(ERROR)
                return msg["result"]
            if "method" in msg:
                self.notifications.append(msg)

    def events(self, deadline):
        while monotonic() < deadline:
            yield self.notifications.pop(0) if self.notifications else self.receive(deadline)
        raise ProviderError(ERROR)

    def models(self):
        result = []
        cursor = None
        while True:
            page = self.call("model/list", {"limit": 100, "cursor": cursor})
            for model in page["data"]:
                if not model.get("hidden"):
                    result.append({"id": model["model"], "name": model["displayName"],
                                   "efforts": [e["reasoningEffort"] for e in model["supportedReasoningEfforts"]],
                                   "default": model["isDefault"]})
            cursor = page.get("nextCursor")
            if not cursor:
                return result

    def close(self):
        if self.proc.poll() is None:
            self.proc.terminate()
            try:
                self.proc.wait(timeout=3)
            except subprocess.TimeoutExpired:
                self.proc.kill()
                self.proc.wait()
        self.proc.stdin.close()
        self.proc.stdout.close()


@contextlib.contextmanager
def runtime(auth=None):
    try:
        with TemporaryDirectory(prefix="dayweave-codex-", dir=os.getenv("DAYWEAVE_CODEX_TMPDIR")) as directory:
            rpc = Runtime(directory, auth)
            try:
                rpc.call("initialize", {"clientInfo": {"name": "dayweave", "version": "1.0.0"},
                                        "capabilities": {"experimentalApi": True}})
                rpc.send({"method": "initialized"})
                yield rpc
            finally:
                rpc.close()
    except (OSError, KeyError, TypeError, ValueError, subprocess.SubprocessError):
        raise ProviderError(ERROR) from None
