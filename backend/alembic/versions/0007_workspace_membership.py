"""Scope assistant records to a member and record workspace scheduling policy."""
import sqlalchemy as sa
from alembic import op

revision = "0007_workspace_membership"
down_revision = "0006_accounts"
branch_labels = None
depends_on = None

PRIVATE = ("conversations", "messages", "ai_turns", "ai_confirmations")


def upgrade():
    for table in PRIVATE:
        op.add_column(table, sa.Column("account_id", sa.String(36), nullable=True))
        op.create_index(f"ix_{table}_account_id", table, ["account_id"])
    op.add_column("change_log", sa.Column("actor_id", sa.String(36), nullable=True))
    op.create_index("ix_change_log_actor_id", "change_log", ["actor_id"])
    op.create_table(
        "workspace_calendar",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("timezone", sa.String(100), nullable=False),
    )


def downgrade():
    op.drop_table("workspace_calendar")
    op.drop_index("ix_change_log_actor_id", table_name="change_log")
    op.drop_column("change_log", "actor_id")
    for table in PRIVATE:
        op.drop_index(f"ix_{table}_account_id", table_name=table)
        op.drop_column(table, "account_id")
