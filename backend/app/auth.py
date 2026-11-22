import hashlib
import hmac
import os
import secrets
import threading
import time
from collections import deque

from fastapi import APIRouter, Depends, Request, Response
from pydantic import Field
from sqlalchemy import delete
from sqlalchemy.orm import Session

from .i18n import DomainError, normalize_language
from .db import SessionLocal, data_dir, get_db
from .models import Admin, AdminSession, Settings
from .records import lock_for_write
from .schemas import Input

router = APIRouter(prefix="/api/auth")
COOKIE = "dayweave_session"
SESSION_SECONDS = 14 * 86400
_attempts: dict[str, deque] = {}
_lock = threading.Lock()


def derive_password(password, salt):
    return hashlib.scrypt(password.encode(), salt=salt, n=2**15, r=8, p=1, dklen=32, maxmem=64*1024**2)


def initialize_admin():
    with SessionLocal.begin() as db:
        lock_for_write(db)
        if db.get(Admin, 1):
            return
        password = os.getenv("DAYWEAVE_ADMIN_PASSWORD")
        if not password:
            path = data_dir() / "admin-password.txt"
            if path.exists():
                password = path.read_text(encoding="utf-8").strip()
            else:
                password = secrets.token_urlsafe(24)
                with open(os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600), "w", encoding="utf-8") as out:
                    out.write(password + "\n")
        if len(password) < 8:
            raise RuntimeError("Initial administrator password must contain at least eight characters.")
        salt = secrets.token_bytes(16)
        db.add(Admin(id=1, password_hash=f"{salt.hex()}:{derive_password(password, salt).hex()}"))


def session_digest(token):
    return hashlib.sha256(token.encode()).hexdigest()


def current_session(request, db):
    token = request.cookies.get(COOKIE)
    if not token or len(token) > 150:
        return None
    session = db.get(AdminSession, session_digest(token))
    return session if session and session.expires_at > int(time.time()) else None


def require_admin(request: Request, db: Session = Depends(get_db)):
    if not current_session(request, db):
        raise DomainError(401, "auth.required")
    settings = db.get(Settings, 1)
    request.state.language = normalize_language(settings.language if settings else None)


@router.get("/status")
def status(request: Request, db: Session = Depends(get_db)):
    return {"authenticated": bool(current_session(request, db))}


class Login(Input):
    password: str = Field(min_length=1, max_length=1024)


@router.post("/login")
def login(body: Login, request: Request, response: Response, db: Session = Depends(get_db)):
    host = request.client.host if request.client else "local"
    cutoff = time.monotonic() - 300
    with _lock:
        for key in list(_attempts):
            if not _attempts[key] or _attempts[key][-1] < cutoff:
                del _attempts[key]
        attempts = _attempts.setdefault(host, deque())
        while attempts and attempts[0] < cutoff:
            attempts.popleft()
        if len(attempts) >= 10:
            raise DomainError(429, "auth.rate_limit")
        attempts.append(time.monotonic())
    admin = db.get(Admin, 1)
    salt, stored = admin.password_hash.split(":")
    if not hmac.compare_digest(derive_password(body.password, bytes.fromhex(salt)).hex(), stored):
        raise DomainError(401, "auth.invalid_password")
    with _lock:
        _attempts.pop(host, None)
    now = int(time.time())
    db.execute(delete(AdminSession).where(AdminSession.expires_at <= now))
    token = secrets.token_urlsafe(32)
    db.add(AdminSession(digest=session_digest(token), expires_at=now+SESSION_SECONDS))
    db.commit()
    response.set_cookie(COOKIE, token, httponly=True, samesite="strict", max_age=SESSION_SECONDS,
                        secure=request.url.scheme == "https" or os.getenv("DAYWEAVE_COOKIE_SECURE") == "1")
    return {"authenticated": True}


@router.post("/logout")
def logout(request: Request, response: Response, db: Session = Depends(get_db)):
    session = current_session(request, db)
    if session:
        db.delete(session)
        db.commit()
    response.delete_cookie(COOKIE, httponly=True, samesite="strict")
    return {"authenticated": False}
