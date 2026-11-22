from datetime import UTC, datetime

from sqlalchemy import JSON, ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db import AccountPrivate, Base


def utcnow() -> str:
    return datetime.now(UTC).isoformat()


class AIProvider(Base):
    __tablename__ = "ai_providers"

    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    name: Mapped[str]
    base_url: Mapped[str]
    model: Mapped[str]
    reasoning: Mapped[str] = mapped_column(default="auto")
    enabled: Mapped[bool] = mapped_column(default=True)
    status: Mapped[str] = mapped_column(default="unconfigured")
    detail: Mapped[str] = mapped_column(default="")
    secret: Mapped[str | None] = mapped_column(Text)
    catalog: Mapped[list] = mapped_column(JSON, default=list)


class Conversation(AccountPrivate, Base):
    __tablename__ = "conversations"

    id: Mapped[int] = mapped_column(primary_key=True)
    title: Mapped[str]
    created_at: Mapped[str] = mapped_column(default=utcnow)


class Message(AccountPrivate, Base):
    __tablename__ = "messages"

    id: Mapped[int] = mapped_column(primary_key=True)
    conversation_id: Mapped[int] = mapped_column(
        ForeignKey("conversations.id"), index=True
    )
    role: Mapped[str]
    content: Mapped[str] = mapped_column(Text)
    provider: Mapped[str]
    model: Mapped[str]
    created_at: Mapped[str] = mapped_column(default=utcnow)
    token_usage: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    tools: Mapped[list] = mapped_column(JSON, default=list)


class ChatTurn(AccountPrivate, Base):
    """Reserve the user's request before network I/O or domain writes."""

    __tablename__ = "ai_turns"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    conversation_id: Mapped[int] = mapped_column(ForeignKey("conversations.id"))
    fingerprint: Mapped[str]
    state: Mapped[str] = mapped_column(default="running")
    lease: Mapped[str] = mapped_column(default="")
    lease_until: Mapped[int] = mapped_column(default=0)
    message_id: Mapped[int | None] = mapped_column(ForeignKey("messages.id"))


class PendingAction(AccountPrivate, Base):
    __tablename__ = "ai_confirmations"

    id: Mapped[int] = mapped_column(primary_key=True)
    turn_id: Mapped[str] = mapped_column(ForeignKey("ai_turns.id"))
    conversation_id: Mapped[int] = mapped_column(ForeignKey("conversations.id"))
    actions: Mapped[list] = mapped_column(JSON)
    summary: Mapped[str]
    status: Mapped[str] = mapped_column(default="pending")
    version: Mapped[int] = mapped_column(default=1)
    result: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[str] = mapped_column(default=utcnow)
