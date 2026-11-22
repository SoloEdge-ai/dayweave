import os
from pathlib import Path

from sqlalchemy import create_engine, event
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker


class Base(DeclarativeBase):
    pass


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


def get_db():
    with SessionLocal() as session:
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
