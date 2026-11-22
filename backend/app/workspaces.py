"""The account registry owns workspace membership and creation."""
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Request
from pydantic import StringConstraints
from sqlalchemy import select
from sqlalchemy.orm import Session

from .auth import Username, create_workspace, current_account
from .db import get_identity_db
from .i18n import DomainError
from .models import Account, WorkspaceMember, WorkspaceRecord
from .records import lock_for_write
from .schemas import Input

router = APIRouter(prefix="/api/workspaces")
DB = Annotated[Session, Depends(get_identity_db)]


class WorkspaceInput(Input):
    name: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=120)]


class MemberInput(Input):
    username: Username


def account_id(request, db):
    account = current_account(request, db)
    if account is None:
        raise DomainError(401, "auth.required")
    return account


def present(row, account):
    return {"id": row.id, "name": row.name, "role": "owner" if row.owner_id == account else "member"}


@router.get("")
def list_workspaces(request: Request, db: DB):
    account = account_id(request, db)
    rows = db.scalars(select(WorkspaceRecord).join(WorkspaceMember)
                      .where(WorkspaceMember.account_id == account)
                      .order_by(WorkspaceMember.created_at, WorkspaceRecord.id))
    return [present(row, account) for row in rows]


@router.post("", status_code=201)
def new_workspace(body: WorkspaceInput, request: Request, db: DB):
    account = account_id(request, db)
    return present(create_workspace(db, account, body.name), account)


def check_owner(request, db, workspace):
    account = account_id(request, db)
    row = db.get(WorkspaceRecord, str(workspace))
    if row is None or row.owner_id != account:
        raise DomainError(404, "workspace.not_found")
    return row


@router.get("/{workspace}/members")
def members(workspace: UUID, request: Request, db: DB):
    row = check_owner(request, db, workspace)
    users = db.scalars(select(Account).join(WorkspaceMember)
                       .where(WorkspaceMember.workspace_id == row.id).order_by(Account.username))
    return [{"id": user.id, "username": user.username, "role": "owner" if row.owner_id == user.id else "member"}
            for user in users]


@router.post("/{workspace}/members", status_code=201)
def add_member(workspace: UUID, body: MemberInput, request: Request, db: DB):
    lock_for_write(db)
    row = check_owner(request, db, workspace)
    user = db.scalar(select(Account).where(Account.username == body.username))
    if user is None:
        raise DomainError(404, "auth.account_not_found")
    if db.get(WorkspaceMember, (row.id, user.id)) is None:
        db.add(WorkspaceMember(workspace_id=row.id, account_id=user.id))
    return {"id": user.id, "username": user.username}


@router.delete("/{workspace}/members/{member}", status_code=204)
def remove_member(workspace: UUID, member: UUID, request: Request, db: DB):
    lock_for_write(db)
    row = check_owner(request, db, workspace)
    if str(member) == row.owner_id:
        raise DomainError(409, "workspace.owner_required")
    membership = db.get(WorkspaceMember, (row.id, str(member)))
    if membership:
        db.delete(membership)
