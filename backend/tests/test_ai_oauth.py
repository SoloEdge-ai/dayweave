"""Local verification fixtures. No OpenAI account, cookie, or live token is used."""

import base64
import hashlib
import json
import threading
import time
from urllib.parse import parse_qs, urlencode, urlsplit
from urllib.request import urlopen

import httpx
import jwt
import pytest
from app.ai import oauth, providers
from app.ai.adapters import ProviderError
from app.ai.secrets import unseal
from app.db import Base
from cryptography.hazmat.primitives.asymmetric import rsa
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker


@pytest.fixture
def registration(tmp_path, monkeypatch):
    monkeypatch.setenv("DAYWEAVE_DATA_DIR", str(tmp_path / "server"))
    monkeypatch.setattr(oauth.Path, "home", lambda: tmp_path / "workstation")
    key = rsa.generate_private_key(65537, 2048)

    class JWKS:
        def __init__(self, *args, **kwargs):
            pass

        def get_signing_key_from_jwt(self, token):
            class Key:
                pass

            k = Key()
            k.key = key.public_key()
            return k

    monkeypatch.setattr(oauth.jwt, "PyJWKClient", JWKS)
    recipient = {
        "public_key": oauth.public_string(oauth.transfer_key()),
        "host_id": oauth.host_id(oauth.data_dir() / ".siwc-host"),
    }
    (tmp_path / "vm.json").write_text(json.dumps(recipient))
    engine = create_engine("sqlite:///" + (tmp_path / "db.sqlite").as_posix())
    Base.metadata.create_all(engine)
    with sessionmaker(bind=engine, expire_on_commit=False)() as db:
        yield tmp_path, db, providers.provider(db, "chatgpt"), key
    engine.dispose()


def test_loopback_pkce_import_model_permission_and_refresh(registration, monkeypatch):
    tmp, db, row, key = registration
    captured = {}

    def browser(url):
        captured.update({k: v[0] for k, v in parse_qs(urlsplit(url).query).items()})
        redirect = captured["redirect_uri"]
        assert redirect.startswith("http://127.0.0.1:")
        q = urlencode(
            {
                "code": "one_use_code",
                "state": captured["state"],
                "client_id": "oaiapp_fixture",
            }
        )

        def callback():
            with urlopen(redirect + "?" + q, timeout=5) as response:
                assert response.status == 200

        threading.Thread(target=callback, daemon=True).start()
        return True

    monkeypatch.setattr(oauth.webbrowser, "open", browser)

    def exchange(url, data, timeout):
        assert url == oauth.TOKEN and data["resource"] == oauth.RESOURCE
        assert data["redirect_uri"] == captured["redirect_uri"]
        assert (
            data["client_id"] == "oaiapp_fixture"
            and captured["client_id"] == "dynamic_agent_client"
        )
        challenge = (
            base64.urlsafe_b64encode(
                hashlib.sha256(data["code_verifier"].encode()).digest()
            )
            .decode()
            .rstrip("=")
        )
        assert challenge == captured["code_challenge"]
        token = jwt.encode(
            {
                "sub": "account-001",
                "iss": oauth.ISSUER,
                "aud": "oaiapp_fixture",
                "nonce": captured["nonce"],
                "iat": int(time.time()),
                "exp": int(time.time()) + 3600,
            },
            key,
            algorithm="RS256",
        )
        return httpx.Response(
            200,
            json={
                "id_token": token,
                "access_token": "access-example",
                "refresh_token": "rotates-1",
                "expires_in": 1,
                "scope": oauth.SCOPES,
            },
        )

    monkeypatch.setattr(oauth.httpx, "post", exchange)
    bundle = tmp / "encrypted.json"
    oauth.login(tmp / "vm.json", bundle)
    assert "access-example" not in bundle.read_text()
    oauth.import_envelope(db, row, json.loads(bundle.read_text()))
    assert row.status == "configured" and "rotates-1" not in row.secret
    assert (
        oauth.host_id(oauth.data_dir() / ".siwc-host") != captured["ext_agent_host_id"]
    )

    def refresh(url, data, timeout):
        assert (
            data["grant_type"] == "refresh_token"
            and data["refresh_token"] == "rotates-1"
            and "scope" not in data
        )
        return httpx.Response(
            200,
            json={
                "access_token": "access-refreshed",
                "refresh_token": "rotates-2",
                "expires_in": 3600,
            },
        )

    monkeypatch.setattr(oauth.httpx, "post", refresh)
    assert oauth.access_token(db, row) == "access-refreshed"
    assert json.loads(unseal(row.secret))["refresh_token"] == "rotates-2"
    assert oauth.access_token(db, row) == "access-refreshed"

    def unavailable(*a, **kw):
        raise httpx.ConnectError("test fixture")

    monkeypatch.setattr(oauth.httpx, "get", unavailable)
    assert not oauth.revoke(db, row)
    assert (
        row.secret is None and row.status == "unconfigured" and "远程撤销" in row.detail
    )


def test_identity_claims_scope_and_expiration(registration):
    _, db, row, key = registration
    now = int(time.time())
    token = jwt.encode(
        {
            "sub": "account",
            "iss": oauth.ISSUER,
            "aud": "oaiapp_a",
            "iat": now,
            "exp": now + 300,
            "nonce": "a",
        },
        key,
        algorithm="RS256",
    )
    assert oauth.claims(token, "oaiapp_a", "a")["sub"] == "account"
    with pytest.raises(ProviderError):
        oauth.claims(token, "oaiapp_wrong", "a")
    with pytest.raises(ProviderError):
        oauth.claims(token, "oaiapp_a", "wrong")
    transfer = oauth.X25519PrivateKey.generate()
    protected = {
        "id_token": token,
        "client_id": "oaiapp_a",
        "subject": "account",
        "nonce": "a",
        "expires_at": now + 100,
        "access_token": "unused",
        "refresh_token": "unused",
        "scopes": ["openid"],
        "host_id": oauth.host_id(oauth.data_dir() / ".siwc-host"),
    }
    cipher = oauth.derive(transfer, oauth.public_string(oauth.transfer_key()))
    envelope = {
        "ephemeral": oauth.public_string(transfer),
        "ciphertext": cipher.encrypt(json.dumps(protected).encode()).decode(),
    }
    oauth.import_envelope(db, row, envelope)
    assert row.status == "permission_required"
    with pytest.raises(ProviderError):
        oauth.access_token(db, row)
