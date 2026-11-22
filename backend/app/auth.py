import hashlib
import hmac
import os
import secrets
import time
from collections import deque
from dataclasses import dataclass
from threading import Lock
from typing import Annotated
from uuid import uuid4

from fastapi import APIRouter, Depends, Request, Response
from pydantic import Field, StringConstraints
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from .db import get_db, get_identity_db, migrate_storage, profile_dir, stored_session, workspace_dir
from . import db as storage
from .i18n import DomainError, normalize_language
from .models import Account, AccountSession, Settings, WorkspaceMember, WorkspaceRecord
from .records import lock_for_write
from .schemas import Input

router = APIRouter(prefix="/api/auth")
COOKIE = "dayweave_session"
SESSION_SECONDS = 14 * 86400
Username = Annotated[str, StringConstraints(to_lower=True, strip_whitespace=True, pattern=r"^[A-Za-z0-9][A-Za-z0-9_.-]{2,47}$")]
_attempts: dict[tuple[str, str], deque] = {}
_lock = Lock()


def derive_password(password, salt):
    return hashlib.scrypt(password.encode(), salt=salt, n=2**15, r=8, p=1, dklen=32, maxmem=64*1024**2)


def add_account(db, username, password):
    lock_for_write(db)
    if db.scalar(select(Account.id).where(Account.username == username)):
        raise DomainError(409, "auth.username_taken")
    salt = secrets.token_bytes(16)
    account = Account(id=str(uuid4()), username=username,
                      password_hash=f"scrypt$v1${salt.hex()}${derive_password(password, salt).hex()}")
    db.add(account)
    db.flush()
    initialize_profile(account.id, create=True)
    create_workspace(db, account.id, "Personal")
    return account


def create_workspace(db, account_id, name):
    workspace = WorkspaceRecord(id=str(uuid4()), owner_id=account_id, name=name)
    db.add(workspace)
    db.flush()
    db.add(WorkspaceMember(workspace_id=workspace.id, account_id=account_id))
    migrate_storage(workspace_dir(workspace.id), create=True)
    db.flush()
    return workspace


def initialize_accounts(db):
    for workspace_id in db.scalars(select(WorkspaceRecord.id)):
        migrate_storage(workspace_dir(workspace_id))
    for account_id in db.scalars(select(Account.id)):
        initialize_profile(account_id)
    initial_password = os.getenv("DAYWEAVE_ADMIN_PASSWORD")
    if initial_password and not db.scalar(select(Account.id).limit(1)):
        if len(initial_password) < 8:
            raise RuntimeError("The bootstrap password must contain at least eight characters.")
        add_account(db, "admin", initial_password)


def initialize_profile(account_id, *, create=False):
    directory = profile_dir(account_id)
    migrate_storage(directory, create=create)
    with stored_session(directory) as profile, profile.begin():
        if profile.get(Settings, 1) is None:
            profile.add(Settings(id=1))


def signup_enabled():
    return os.getenv("DAYWEAVE_ENABLE_SIGNUP", "1") == "1"


def session_digest(token):
    return hashlib.sha256(token.encode()).hexdigest()


def current_session(request, db):
    token = request.cookies.get(COOKIE)
    if not token or len(token) > 150:
        return None
    session = db.get(AccountSession, session_digest(token))
    return session if session and session.expires_at > int(time.time()) else None


def current_account(request, db):
    session = current_session(request, db)
    if session is None:
        return None
    expected = request.headers.get("X-DayWeave-Account")
    if expected is not None and expected != session.account_id:
        return None
    return session.account_id


@dataclass(frozen=True)
class WorkspaceAccess:
    workspace_id: str
    account_id: str
    owner: bool


def current_workspace(request, db):
    account = current_account(request, db)
    if account is None:
        return None
    query = select(WorkspaceRecord.id, WorkspaceRecord.owner_id).join(WorkspaceMember)
    query = query.where(WorkspaceMember.account_id == account)
    selected = request.headers.get("X-DayWeave-Workspace")
    if selected is None and request.method == "GET":
        selected = request.query_params.get("workspace")
    if selected is not None:
        query = query.where(WorkspaceRecord.id == selected)
    found = db.execute(query.order_by(WorkspaceMember.created_at, WorkspaceRecord.id).limit(1)).first()
    return WorkspaceAccess(found.id, account, found.owner_id == account) if found else None


def request_workspace(request):
    with storage.SessionLocal() as db:
        workspace = current_workspace(request, db)
    if workspace is None:
        raise DomainError(401, "auth.required")
    return workspace


def require_admin(request: Request, db: Session = Depends(get_db)):
    settings = db.get(Settings, 1)
    request.state.language = normalize_language(settings.language if settings else None)


def status_for(account):
    return {
        "authenticated": account is not None,
        "signup_enabled": signup_enabled(),
        "account": {"id": account.id, "username": account.username} if account else None,
    }


@router.get("/status")
def status(request: Request, db: Session = Depends(get_identity_db)):
    session = current_session(request, db)
    return status_for(db.get(Account, session.account_id) if session else None)


class Login(Input):
    username: Username = "admin"
    password: str = Field(min_length=1, max_length=1024)


class Register(Input):
    username: Username
    password: str = Field(min_length=10, max_length=1024)


def attempt(request, operation):
    key = (operation, request.client.host if request.client else "local")
    cutoff = time.monotonic() - 300
    with _lock:
        for previous in list(_attempts):
            if not _attempts[previous] or _attempts[previous][-1] < cutoff:
                del _attempts[previous]
        attempts = _attempts.setdefault(key, deque())
        while attempts and attempts[0] < cutoff:
            attempts.popleft()
        if len(attempts) >= 10:
            raise DomainError(429, "auth.rate_limit")
        attempts.append(time.monotonic())
    return key


def start_session(account, request, response, db):
    previous = current_session(request, db)
    if previous:
        db.delete(previous)
    now = int(time.time())
    db.execute(delete(AccountSession).where(AccountSession.expires_at <= now))
    token = secrets.token_urlsafe(32)
    db.add(AccountSession(digest=session_digest(token), account_id=account.id,
                          created_at=now, expires_at=now+SESSION_SECONDS))
    db.commit()
    response.set_cookie(COOKIE, token, httponly=True, samesite="strict", max_age=SESSION_SECONDS,
                        secure=request.url.scheme == "https" or os.getenv("DAYWEAVE_COOKIE_SECURE") == "1")
    return status_for(account)


@router.post("/register", status_code=201)
def register(body: Register, request: Request, response: Response, db: Session = Depends(get_identity_db)):
    if not signup_enabled():
        raise DomainError(403, "auth.signup_disabled")
    attempt(request, "signup")
    account = add_account(db, body.username, body.password)
    return start_session(account, request, response, db)


@router.post("/login")
def login(body: Login, request: Request, response: Response, db: Session = Depends(get_identity_db)):
    key = attempt(request, "login:" + body.username)
    account = db.scalar(select(Account).where(Account.username == body.username))
    expected = f"scrypt$v1${'00' * 16}${'00' * 32}"
    if account and account.password_hash.startswith("scrypt$v1$"):
        expected = account.password_hash
    _, _, salt, stored = expected.split("$")
    if not hmac.compare_digest(derive_password(body.password, bytes.fromhex(salt)).hex(), stored) or not account:
        raise DomainError(401, "auth.invalid_password")
    with _lock:
        _attempts.pop(key, None)
    return start_session(account, request, response, db)


@router.post("/logout")
def logout(request: Request, response: Response, db: Session = Depends(get_identity_db)):
    session = current_session(request, db)
    if session:
        expected = request.headers.get("X-DayWeave-Account")
        if expected is not None and expected != session.account_id:
            raise DomainError(401, "auth.required")
        db.delete(session)
        db.commit()
    response.delete_cookie(COOKIE, httponly=True, samesite="strict",
                           secure=request.url.scheme == "https" or os.getenv("DAYWEAVE_COOKIE_SECURE") == "1")
    return {"authenticated": False}
