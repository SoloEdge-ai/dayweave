import os
from functools import lru_cache
from pathlib import Path
from uuid import UUID

from fastapi import Request
from sqlalchemy import String, create_engine, event
from sqlalchemy.pool import NullPool
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column, sessionmaker, with_loader_criteria


class Base(DeclarativeBase):
    pass


class AccountPrivate:
    account_id: Mapped[str | None] = mapped_column(String(36), index=True)


@event.listens_for(Session, "do_orm_execute")
def scope_private_records(state):
    actor = state.session.info.get("account_id")
    if actor and state.is_select:
        state.statement = state.statement.options(
            with_loader_criteria(AccountPrivate, lambda row: row.account_id == actor, include_aliases=True)
        )


@event.listens_for(Session, "before_flush")
def enforce_private_record_owner(session, *_):
    actor = session.info.get("account_id")
    if not actor:
        return
    for row in session.new:
        if isinstance(row, AccountPrivate):
            row.account_id = actor
    for row in session.dirty.union(session.deleted):
        if isinstance(row, AccountPrivate) and row.account_id != actor:
            raise RuntimeError("Private assistant record belongs to another account.")


def data_dir() -> Path:
    default = Path(__file__).resolve().parents[2] / "data"
    path = Path(os.getenv("DAYWEAVE_DATA_DIR", str(default))).resolve()
    path.mkdir(mode=0o700, parents=True, exist_ok=True)
    return path


def sqlite_url() -> str:
    return "sqlite:///" + (data_dir() / "dayweave.db").as_posix()


engine = create_engine(sqlite_url(), connect_args={"check_same_thread": False, "timeout": 20})


@event.listens_for(engine, "connect")
def configure_sqlite(connection, _):
    connection.execute("PRAGMA foreign_keys=ON")
    connection.execute("PRAGMA journal_mode=WAL")
    connection.execute("PRAGMA busy_timeout=20000")


SessionLocal = sessionmaker(bind=engine, expire_on_commit=False)


def get_identity_db():
    with SessionLocal() as session:
        try:
            yield session
            session.commit()
        except BaseException:
            session.rollback()
            raise


@lru_cache(maxsize=64)
def workspace_sessions(directory: Path):
    workspace_engine = create_engine(
        "sqlite:///" + (directory / "workspace.db").as_posix(),
        connect_args={"check_same_thread": False, "timeout": 20},
        poolclass=NullPool,
    )
    event.listen(workspace_engine, "connect", configure_sqlite)
    return sessionmaker(bind=workspace_engine, expire_on_commit=False, info={"workspace_dir": directory})


def workspace_dir(workspace_id: str):
    return data_dir() / "workspaces" / str(UUID(workspace_id))


def profile_dir(account_id: str):
    return data_dir() / "profiles" / str(UUID(account_id))


def stored_session(directory: Path):
    if not (directory / "workspace.db").is_file():
        raise RuntimeError("Account or workspace database is missing from server storage.")
    return workspace_sessions(directory)()


def open_workspace(workspace_id: str, account_id: str, *, owner=False):
    from .ai.models import AIProvider
    from .models import Settings

    location, profile = workspace_dir(workspace_id), profile_dir(account_id)
    with stored_session(location) as workspace, stored_session(profile) as account:
        binds = {Settings: account.get_bind(), AIProvider: account.get_bind()}
        info = {"workspace_dir": location, "profile_dir": profile, "workspace_id": workspace_id,
                "account_id": account_id, "workspace_owner": owner, "profile_binds": binds}
        return workspace_sessions(location)(binds=binds, info=info)


def stream_sessions(db):
    return sessionmaker(bind=db.get_bind(), binds=db.info.get("profile_binds"),
                        expire_on_commit=False, info=dict(db.info))


def migrate_storage(directory: Path, *, create=False):
    from alembic import command
    from alembic.config import Config

    if create:
        directory.mkdir(mode=0o700, parents=True, exist_ok=False)
    with (workspace_sessions(directory)() if create else stored_session(directory)) as session:
        config = Config(str(Path(__file__).resolve().parents[1] / "alembic.ini"))
        config.set_main_option("script_location", str(Path(__file__).resolve().parents[1] / "alembic"))
        with session.get_bind().connect() as connection:
            config.attributes.update(connection=connection, workspace=True)
            command.upgrade(config, "head")


def get_db(request: Request):
    from .auth import request_workspace

    access = request_workspace(request)
    with open_workspace(access.workspace_id, access.account_id, owner=access.owner) as session:
        try:
            yield session
            session.commit()
        except BaseException:
            session.rollback()
            raise


@event.listens_for(Session, "after_rollback")
def remove_rolled_back_uploads(session):
    for path in session.info.pop("new_uploads", []):
        path.unlink(missing_ok=True)


@event.listens_for(Session, "after_commit")
def retain_committed_uploads(session):
    session.info.pop("new_uploads", None)
