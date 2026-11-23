from datetime import datetime, timezone

from sqlalchemy import JSON, Boolean, Column, Date, ForeignKey, Integer, String, Table, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .db import Base


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="microseconds")


task_resources = Table(
    "task_resources", Base.metadata,
    Column("task_id", ForeignKey("tasks.id"), primary_key=True),
    Column("resource_id", ForeignKey("resources.id"), primary_key=True),
)
resource_projects = Table(
    "resource_projects", Base.metadata,
    Column("resource_id", ForeignKey("resources.id"), primary_key=True),
    Column("project_id", ForeignKey("projects.id"), primary_key=True),
)


class Record:
    id: Mapped[int] = mapped_column(primary_key=True)
    created_at: Mapped[str] = mapped_column(String, default=now_iso)
    updated_at: Mapped[str] = mapped_column(String, default=now_iso)
    deleted: Mapped[bool] = mapped_column(Boolean, default=False, index=True)


class Project(Record, Base):
    __tablename__ = "projects"
    name: Mapped[str] = mapped_column(String(200))
    description: Mapped[str] = mapped_column(Text, default="")
    status: Mapped[str] = mapped_column(String, default="active")
    target_date = mapped_column(Date, nullable=True)


class Resource(Record, Base):
    __tablename__ = "resources"
    title: Mapped[str] = mapped_column(String(500))
    url: Mapped[str | None] = mapped_column(Text, unique=True)
    type: Mapped[str] = mapped_column(String)
    source: Mapped[str] = mapped_column(String, default="")
    description: Mapped[str] = mapped_column(Text, default="")
    reason: Mapped[str] = mapped_column(Text, default="")
    notes: Mapped[str] = mapped_column(Text, default="")
    duration_seconds: Mapped[int | None] = mapped_column(Integer)
    total_pages: Mapped[int | None] = mapped_column(Integer)
    position_unit: Mapped[str] = mapped_column(String)
    current_position: Mapped[int] = mapped_column(Integer, default=0)
    progress_status: Mapped[str] = mapped_column(String, default="unstarted")
    file_path: Mapped[str | None] = mapped_column(String)
    original_filename: Mapped[str | None] = mapped_column(String)
    projects: Mapped[list[Project]] = relationship(secondary=resource_projects, order_by=Project.id)


class Tag(Base):
    __tablename__ = "tags"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(300))
    name_key: Mapped[str] = mapped_column(String, unique=True)


task_tags = Table(
    "task_tags", Base.metadata,
    Column("task_id", ForeignKey("tasks.id", ondelete="CASCADE"), primary_key=True),
    Column("tag_id", ForeignKey("tags.id", ondelete="CASCADE"), primary_key=True, index=True),
)


class TaskResumeNote(Base):
    __tablename__ = "task_resume_notes"
    account_id: Mapped[str] = mapped_column(String(36), primary_key=True)
    task_id: Mapped[int] = mapped_column(ForeignKey("tasks.id", ondelete="CASCADE"), primary_key=True)
    text: Mapped[str] = mapped_column(Text)
    updated_at: Mapped[str]


class Task(Record, Base):
    __tablename__ = "tasks"
    title: Mapped[str] = mapped_column(String(500))
    description: Mapped[str] = mapped_column(Text, default="")
    status: Mapped[str] = mapped_column(String, default="todo", index=True)
    priority: Mapped[str] = mapped_column(String, default="medium")
    project_id: Mapped[int | None] = mapped_column(ForeignKey("projects.id"), index=True)
    primary_resource_id: Mapped[int | None] = mapped_column(ForeignKey("resources.id", ondelete="SET NULL"))
    category: Mapped[str] = mapped_column(String, default="")
    estimated_minutes: Mapped[int | None] = mapped_column(Integer)
    scheduled_date = mapped_column(Date, nullable=True, index=True)
    planning_window: Mapped[str | None] = mapped_column(String)
    window_start = mapped_column(Date, nullable=True, index=True)
    scheduled_period: Mapped[str | None] = mapped_column(String)
    planned_start_at: Mapped[str | None] = mapped_column(String)
    planned_end_at: Mapped[str | None] = mapped_column(String)
    due_date = mapped_column(Date, nullable=True, index=True)
    due_period: Mapped[str | None] = mapped_column(String)
    due_at: Mapped[str | None] = mapped_column(String, index=True)
    completed_at: Mapped[str | None] = mapped_column(String)
    pinned: Mapped[bool] = mapped_column(Boolean, default=False)
    tags: Mapped[list[Tag]] = relationship(secondary=task_tags, order_by=Tag.id, lazy="selectin")
    resources: Mapped[list[Resource]] = relationship(secondary=task_resources, order_by=Resource.id)


class Settings(Base):
    __tablename__ = "user_settings"
    id: Mapped[int] = mapped_column(primary_key=True)
    language: Mapped[str] = mapped_column(String, default="zh-CN")
    timezone: Mapped[str] = mapped_column(String, default="Asia/Hong_Kong")
    theme: Mapped[str] = mapped_column(String, default="system")
    week_start: Mapped[int] = mapped_column(Integer, default=0)
    default_provider: Mapped[str | None] = mapped_column(String)
    default_model: Mapped[str | None] = mapped_column(String)
    default_reasoning: Mapped[str] = mapped_column(String, default="auto")
    planning_preferences: Mapped[str] = mapped_column(Text, default="")


class CalendarSettings(Base):
    __tablename__ = "workspace_calendar"
    id: Mapped[int] = mapped_column(primary_key=True)
    timezone: Mapped[str] = mapped_column(String(100), default="Asia/Hong_Kong")


class TaskChangeLog(Base):
    __tablename__ = "change_log"
    id: Mapped[int] = mapped_column(primary_key=True)
    entity_type: Mapped[str] = mapped_column(String)
    entity_id: Mapped[int] = mapped_column(Integer)
    action: Mapped[str] = mapped_column(String)
    before: Mapped[dict | None] = mapped_column(JSON)
    after: Mapped[dict | None] = mapped_column(JSON)
    source: Mapped[str] = mapped_column(String)
    conversation_id: Mapped[int | None] = mapped_column(Integer)
    actor_id: Mapped[str | None] = mapped_column(String(36), index=True)
    created_at: Mapped[str] = mapped_column(String, default=now_iso)
    undone_at: Mapped[str | None] = mapped_column(String)


class Account(Base):
    __tablename__ = "accounts"
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    username: Mapped[str] = mapped_column(String(48), unique=True)
    email: Mapped[str] = mapped_column(String(254), unique=True)
    password_hash: Mapped[str] = mapped_column(String)
    created_at: Mapped[str] = mapped_column(String, default=now_iso)


class WorkspaceRecord(Base):
    __tablename__ = "workspaces"
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    owner_id: Mapped[str] = mapped_column(ForeignKey("accounts.id"), index=True)
    name: Mapped[str] = mapped_column(String(120))
    created_at: Mapped[str] = mapped_column(String, default=now_iso)


class WorkspaceMember(Base):
    __tablename__ = "workspace_members"
    workspace_id: Mapped[str] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"), primary_key=True)
    account_id: Mapped[str] = mapped_column(ForeignKey("accounts.id", ondelete="CASCADE"), primary_key=True, index=True)
    created_at: Mapped[str] = mapped_column(String, default=now_iso)


class AccountSession(Base):
    __tablename__ = "account_sessions"
    digest: Mapped[str] = mapped_column(String(64), primary_key=True)
    account_id: Mapped[str] = mapped_column(ForeignKey("accounts.id", ondelete="CASCADE"), index=True)
    created_at: Mapped[int] = mapped_column(Integer)
    expires_at: Mapped[int] = mapped_column(Integer, index=True)


class EmailChallenge(Base):
    __tablename__ = "email_challenges"
    email: Mapped[str] = mapped_column(String(254), primary_key=True)
    purpose: Mapped[str] = mapped_column(String(16), primary_key=True)
    digest: Mapped[str] = mapped_column(String(64))
    issued_at: Mapped[int] = mapped_column(Integer, index=True)
    delivery_state: Mapped[str] = mapped_column(String(16), default="submitted", server_default="submitted")
    attempts: Mapped[int] = mapped_column(Integer)
