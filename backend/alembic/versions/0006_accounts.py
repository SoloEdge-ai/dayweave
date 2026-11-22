"""Add the account, workspace and session registry."""
import sqlalchemy as sa
from alembic import op

revision = "0006_accounts"
down_revision = "0005_planning_windows"
branch_labels = None
depends_on = None


def upgrade():
    if op.get_context().config.attributes.get("workspace"):
        return
    op.create_table(
        "accounts",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("username", sa.String(48), nullable=False, unique=True),
        sa.Column("password_hash", sa.String(), nullable=False),
        sa.Column("created_at", sa.String(), nullable=False),
    )
    op.create_table(
        "workspaces",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("owner_id", sa.String(36), sa.ForeignKey("accounts.id"), nullable=False),
        sa.Column("name", sa.String(120), nullable=False),
        sa.Column("created_at", sa.String(), nullable=False),
    )
    op.create_index("ix_workspaces_owner_id", "workspaces", ["owner_id"])
    op.create_table(
        "workspace_members",
        sa.Column("workspace_id", sa.String(36), sa.ForeignKey("workspaces.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("account_id", sa.String(36), sa.ForeignKey("accounts.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("created_at", sa.String(), nullable=False),
    )
    op.create_index("ix_workspace_members_account_id", "workspace_members", ["account_id"])
    op.create_table(
        "account_sessions",
        sa.Column("digest", sa.String(64), primary_key=True),
        sa.Column("account_id", sa.String(36), sa.ForeignKey("accounts.id", ondelete="CASCADE"), nullable=False),
        sa.Column("created_at", sa.Integer(), nullable=False),
        sa.Column("expires_at", sa.Integer(), nullable=False),
    )
    op.create_index("ix_account_sessions_account_id", "account_sessions", ["account_id"])
    op.create_index("ix_account_sessions_expires_at", "account_sessions", ["expires_at"])


def downgrade():
    if op.get_context().config.attributes.get("workspace"):
        return
    op.drop_table("account_sessions")
    op.drop_table("workspace_members")
    op.drop_table("workspaces")
    op.drop_table("accounts")
