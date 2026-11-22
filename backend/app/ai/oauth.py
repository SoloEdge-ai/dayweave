"""Official Sign in with ChatGPT, using a local callback and encrypted SSH transfer.

Run "python -m app.ai.oauth --help" on the appropriate host.
"""

import argparse
import base64
import hashlib
import hmac
import json
import os
import secrets
import sys
import time
import uuid
import webbrowser
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlencode, urlsplit

import httpx
import jwt
from cryptography.fernet import Fernet
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric.x25519 import (
    X25519PrivateKey,
    X25519PublicKey,
)
from cryptography.hazmat.primitives.kdf.hkdf import HKDF

from app.db import data_dir

from .adapters import ProviderError
from .secrets import seal, unseal

ISSUER = "https://auth.openai.com"
RESOURCE = "https://api.openai.com/v1"
TOKEN = ISSUER + "/api/accounts/oauth/token"
DIRECT = "chatgpt.tokens.use.direct"
SCOPES = "openid profile email offline_access resource.invoke " + DIRECT
ENC = serialization.Encoding.Raw


def preserve(path, contents):
    """Exclusive creation keeps a stable host identity across concurrent first use."""
    path.parent.mkdir(parents=True, exist_ok=True)
    try:
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    except FileExistsError:
        return
    with os.fdopen(fd, "w", encoding="utf8") as out:
        out.write(contents)


def host_id(path):
    preserve(path, "urn:uuid:" + str(uuid.uuid4()))
    return path.read_text(encoding="utf8").strip()


def transfer_key(directory=None):
    path = (directory or data_dir()) / ".siwc-transfer-key"
    generated = X25519PrivateKey.generate()
    raw = generated.private_bytes(
        ENC, serialization.PrivateFormat.Raw, serialization.NoEncryption()
    )
    preserve(path, seal(base64.b64encode(raw).decode()))
    return X25519PrivateKey.from_private_bytes(
        base64.b64decode(unseal(path.read_text()))
    )


def public_string(key):
    return base64.b64encode(
        key.public_key().public_bytes(ENC, serialization.PublicFormat.Raw)
    ).decode()


def derive(key, peer):
    shared = key.exchange(
        X25519PublicKey.from_public_bytes(base64.b64decode(peer, validate=True))
    )
    derived = HKDF(
        algorithm=hashes.SHA256(),
        length=32,
        salt=None,
        info=b"DayWeave SIWC transfer v1",
    ).derive(shared)
    return Fernet(base64.urlsafe_b64encode(derived))


def claims(token, client, nonce=None):
    try:
        jwks = jwt.PyJWKClient(ISSUER + "/.well-known/jwks.json", timeout=10)
        key = jwks.get_signing_key_from_jwt(token).key
        data = jwt.decode(
            token,
            key,
            algorithms=["RS256"],
            audience=client,
            issuer=ISSUER,
            leeway=5,
            options={"require": ["sub", "aud", "iss", "exp", "iat"]},
        )
        if nonce and not hmac.compare_digest(nonce, data.get("nonce", "")):
            raise ValueError()
        if not data["sub"]:
            raise ValueError()
        return data
    except (jwt.PyJWTError, ValueError, TypeError, OSError):
        raise ProviderError("OpenAI 身份令牌验证失败，请重新授权。") from None


def login(recipient_path, output_path):
    if output_path.exists():
        raise ProviderError("输出文件已存在，请选择新的文件名。")
    recipient = json.loads(recipient_path.read_text(encoding="utf-8-sig"))
    # Bind returned encrypted credentials to the intended VM, independently of laptop identity.
    laptop = Path.home() / ".dayweave-siwc"
    laptop.mkdir(mode=0o700, parents=True, exist_ok=True)
    local_host = host_id(laptop / "host-id")
    profile = laptop / (
        "registration-" + hashlib.sha256(recipient["host_id"].encode()).hexdigest()[:24]
    )
    prior = json.loads(profile.read_text()) if profile.exists() else {}
    verifier, state, nonce = (secrets.token_urlsafe(42) for _ in range(3))
    callback = {}

    class Callback(BaseHTTPRequestHandler):
        def log_message(self, *_):
            pass

        def do_GET(self):
            parsed = urlsplit(self.path)
            params = {k: v[0] for k, v in parse_qs(parsed.query).items() if len(v) == 1}
            valid = parsed.path == "/auth/callback" and hmac.compare_digest(
                params.get("state", ""), state
            )
            self.send_response(200 if valid else 400)
            self.send_header("Content-Type", "text/plain; charset=utf-8")
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(
                b"Return to the DayWeave terminal." if valid else b"Invalid callback."
            )
            if valid:
                callback.update(params)

    with HTTPServer(("127.0.0.1", 0), Callback) as server:
        redirect = f"http://127.0.0.1:{server.server_port}/auth/callback"
        params = {
            "client_id": prior.get("client_id", "dynamic_agent_client"),
            "ext_agent_host_id": local_host,
            "response_type": "code",
            "redirect_uri": redirect,
            "scope": SCOPES,
            "resource": RESOURCE,
            "state": state,
            "nonce": nonce,
            "code_challenge_method": "S256",
            "code_challenge": base64.urlsafe_b64encode(
                hashlib.sha256(verifier.encode()).digest()
            )
            .decode()
            .rstrip("="),
        }
        if not prior:
            params["agent_name_hint"] = "DayWeave"
        else:
            params["prompt"] = "consent"
        url = ISSUER + "/api/accounts/authorize?" + urlencode(params)
        if not webbrowser.open(url):
            print(
                "Open this one-time authorization URL in a local browser:",
                url,
                file=sys.stderr,
            )
        deadline = time.monotonic() + 240
        server.timeout = 1
        while not callback and time.monotonic() < deadline:
            server.handle_request()
    client_id = callback.get("client_id", prior.get("client_id"))
    if (
        callback.get("error")
        or not callback.get("code")
        or not client_id
        or client_id == "dynamic_agent_client"
    ):
        raise ProviderError("授权未完成或用户取消了本次授权。")
    if prior and prior["client_id"] != client_id:
        raise ProviderError("此次授权与保存的客户端身份不匹配。")
    response = httpx.post(
        TOKEN,
        data={
            "grant_type": "authorization_code",
            "client_id": client_id,
            "code": callback["code"],
            "code_verifier": verifier,
            "redirect_uri": redirect,
            "resource": RESOURCE,
        },
        timeout=15,
    )
    if response.status_code != 200:
        raise ProviderError(f"OpenAI 授权码交换失败（HTTP {response.status_code}）。")
    obj = response.json()
    identity = claims(obj["id_token"], client_id, nonce)
    if prior and prior["subject"] != identity["sub"]:
        raise ProviderError("账号身份与之前的注册不匹配。")
    registration = {"client_id": client_id, "subject": identity["sub"]}
    preserve(profile, json.dumps(registration))
    protected = {
        **registration,
        "access_token": obj.get("access_token", ""),
        "refresh_token": obj.get("refresh_token", ""),
        "id_token": obj["id_token"],
        "nonce": nonce,
        "scopes": obj.get("scope", "").split(),
        "expires_at": time.time() + int(obj.get("expires_in", 0)),
        "host_id": recipient["host_id"],
    }
    ephemeral = X25519PrivateKey.generate()
    envelope = (
        derive(ephemeral, recipient["public_key"])
        .encrypt(json.dumps(protected).encode())
        .decode()
    )
    with output_path.open("x", encoding="utf8") as output:
        json.dump(
            {"ephemeral": public_string(ephemeral), "ciphertext": envelope}, output
        )
    print("Transfer the encrypted envelope to the VM and import it promptly.")


def import_envelope(db, row, envelope):
    directory = db.info.get("profile_dir", data_dir())
    obj = json.loads(
        derive(transfer_key(directory), envelope["ephemeral"]).decrypt(
            envelope["ciphertext"], ttl=600
        )
    )
    if obj.get("host_id") != host_id(directory / ".siwc-host"):
        raise ProviderError("授权文件属于其他主机。")
    identity = claims(obj["id_token"], obj["client_id"], obj.pop("nonce"))
    if identity["sub"] != obj["subject"]:
        raise ProviderError("OpenAI 账号身份不匹配。")
    if row.secret:
        prior = json.loads(unseal(row.secret))
        if prior["client_id"] != obj["client_id"] or prior["subject"] != obj["subject"]:
            raise ProviderError("请先断开当前 ChatGPT 账号，再连接其他账号。")
    row.secret, row.catalog, row.model = seal(json.dumps(obj)), [], ""
    row.status = "configured" if DIRECT in obj["scopes"] else "permission_required"
    row.detail = (
        "授权已导入，请测试连接以加载模型。"
        if row.status == "configured"
        else "已登录，但未授予 ChatGPT 套餐调用权限。"
    )
    db.commit()


def access_token(db, row):
    from sqlalchemy import text

    # Reserve SQLite before reading a rotating refresh token, including across processes.
    db.commit()
    db.execute(text("BEGIN IMMEDIATE"))
    db.refresh(row)
    if not row.secret:
        db.commit()
        raise ProviderError("请先完成 ChatGPT 官方授权。")
    obj = json.loads(unseal(row.secret))
    if DIRECT not in obj["scopes"]:
        db.commit()
        raise ProviderError("此授权未授予 ChatGPT 套餐调用权限。")
    if obj["expires_at"] > time.time() + 90:
        db.commit()
        return obj["access_token"]
    try:
        response = httpx.post(
            TOKEN,
            data={
                "grant_type": "refresh_token",
                "client_id": obj["client_id"],
                "refresh_token": obj["refresh_token"],
                "resource": RESOURCE,
            },
            timeout=10,
        )
        if not response.is_success:
            if response.status_code in (400, 401):
                row.status, row.detail = (
                    "reauthorize",
                    "ChatGPT 会话已失效，请重新授权。",
                )
            raise ProviderError(
                f"ChatGPT 授权刷新失败（HTTP {response.status_code}）。"
            )
        new = response.json()
        if "id_token" in new:
            if claims(new["id_token"], obj["client_id"])["sub"] != obj["subject"]:
                raise ProviderError("授权刷新返回了其他账号。")
            obj["id_token"] = new["id_token"]
        obj["access_token"] = new["access_token"]
        obj["refresh_token"] = new.get("refresh_token") or obj["refresh_token"]
        obj["expires_at"] = time.time() + int(new["expires_in"])
        if "scope" in new:
            obj["scopes"] = new["scope"].split()
        row.secret = seal(json.dumps(obj))
        if DIRECT not in obj["scopes"]:
            raise ProviderError("已失去 ChatGPT 套餐调用权限。")
        return obj["access_token"]
    except httpx.RequestError:
        raise ProviderError("ChatGPT 刷新服务暂时不可达。") from None
    finally:
        db.commit()


def revoke(db, row):
    if not row.secret:
        return True
    obj = json.loads(unseal(row.secret))
    confirmed = False
    try:
        discovery = httpx.get(ISSUER + "/.well-known/openid-configuration", timeout=8)
        discovery.raise_for_status()
        endpoint = discovery.json()["revocation_endpoint"]
        if (
            urlsplit(endpoint).netloc != "auth.openai.com"
            or urlsplit(endpoint).scheme != "https"
        ):
            raise ProviderError("OpenAI 撤销端点无法验证。")
        for attempt in range(2):
            response = httpx.post(
                endpoint,
                data={
                    "token": obj["refresh_token"],
                    "token_type_hint": "refresh_token",
                    "client_id": obj["client_id"],
                },
                timeout=8,
            )
            confirmed = response.status_code == 200
            if confirmed or response.status_code < 500:
                break
            time.sleep(0.4)
    except (httpx.HTTPError, ValueError, KeyError, ProviderError):
        pass
    row.secret, row.catalog, row.model = None, [], ""
    row.status = "unconfigured"
    row.detail = (
        "已断开授权。"
        if confirmed
        else "本地已断开；请在 ChatGPT 设置中核实远程撤销结果。"
    )
    db.commit()
    return confirmed


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    prepare = sub.add_parser("prepare", help="On the VM, print the workspace's public transfer descriptor.")
    auth = sub.add_parser(
        "login",
        help="On your browser computer, authorize an eligible DayWeave installation.",
    )
    auth.add_argument(
        "--eligible",
        action="store_true",
        required=True,
        help="Confirm this installation qualifies for the official OSS flow or has OpenAI approval.",
    )
    auth.add_argument("--recipient", type=Path, required=True)
    auth.add_argument("--out", type=Path, required=True)
    import_command = sub.add_parser(
        "import",
        help="On the VM, read a sealed credential envelope from standard input.",
    )
    for command in (prepare, import_command):
        command.add_argument("--username", required=True, help="Account that owns the workspace")
    args = parser.parse_args()
    if args.command == "login":
        login(args.recipient, args.out)
        return
    from sqlalchemy import select
    from app.db import SessionLocal, profile_dir, stored_session
    from app.models import Account

    with SessionLocal() as registry:
        account = registry.scalar(select(Account.id).where(Account.username == args.username.strip().lower()))
    if account is None:
        parser.error("No account for that username.")
    directory = profile_dir(account)
    if args.command == "prepare":
        with stored_session(directory):
            print(json.dumps({"host_id": host_id(directory / ".siwc-host"), "public_key": public_string(transfer_key(directory))}))
    else:
        from .providers import provider

        with stored_session(directory) as db:
            db.info["profile_dir"] = directory
            import_envelope(db, provider(db, "chatgpt"), json.load(sys.stdin))
        print("Registration imported. Test the connection in Settings.")


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:  # noqa: BLE001 - avoid credential-bearing CLI tracebacks
        # Never stringify unexpected HTTP, JWT, parser or validation errors containing credentials.
        sys.exit(
            str(exc)
            if isinstance(exc, ProviderError)
            else "Authorization operation failed. Verify files, network and installation."
        )
