"""Add AI providers, local conversations, replay keys and reviewable actions."""

import sqlalchemy as sa
from alembic import op

revision = "0002_ai"
down_revision = "0001_core"
branch_labels = None
depends_on = None


def upgrade():
    col = sa.Column
    string = sa.String
    op.create_table(
        "ai_providers",
        col("id", string(32), primary_key=True),
        col("name", string(), nullable=False),
        col("base_url", string(), nullable=False),
        col("model", string(), nullable=False),
        col("reasoning", string(), nullable=False),
        col("enabled", sa.Boolean(), nullable=False),
        col("status", string(), nullable=False),
        col("detail", string(), nullable=False),
        col("secret", sa.Text()),
        col("catalog", sa.JSON(), nullable=False),
    )
    op.create_table(
        "conversations",
        col("id", sa.Integer(), primary_key=True),
        col("title", string(), nullable=False),
        col("created_at", string(), nullable=False),
    )
    op.create_table(
        "messages",
        col("id", sa.Integer(), primary_key=True),
        col(
            "conversation_id",
            sa.Integer(),
            sa.ForeignKey("conversations.id"),
            nullable=False,
        ),
        col("role", string(), nullable=False),
        col("content", sa.Text(), nullable=False),
        col("provider", string(), nullable=False),
        col("model", string(), nullable=False),
        col("created_at", string(), nullable=False),
        col("tools", sa.JSON(), nullable=False),
    )
    op.create_index("ix_messages_conversation_id", "messages", ["conversation_id"])
    op.create_table(
        "ai_turns",
        col("id", string(64), primary_key=True),
        col(
            "conversation_id",
            sa.Integer(),
            sa.ForeignKey("conversations.id"),
            nullable=False,
        ),
        col("fingerprint", string(), nullable=False),
        col("state", string(), nullable=False),
        col("message_id", sa.Integer(), sa.ForeignKey("messages.id")),
    )
    op.create_table(
        "ai_confirmations",
        col("id", sa.Integer(), primary_key=True),
        col("turn_id", string(64), sa.ForeignKey("ai_turns.id"), nullable=False),
        col(
            "conversation_id",
            sa.Integer(),
            sa.ForeignKey("conversations.id"),
            nullable=False,
        ),
        col("actions", sa.JSON(), nullable=False),
        col("summary", string(), nullable=False),
        col("status", string(), nullable=False),
        col("result", sa.JSON()),
        col("created_at", string(), nullable=False),
    )


def downgrade():
    for table in (
        "ai_confirmations",
        "ai_turns",
        "messages",
        "conversations",
        "ai_providers",
    ):
        op.drop_table(table)
