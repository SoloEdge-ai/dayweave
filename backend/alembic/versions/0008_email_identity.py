"""Require verified email addresses in a fresh identity registry."""
import sqlalchemy as sa
from alembic import op

revision = "0008_email_identity"
down_revision = "0007_workspace_membership"
branch_labels = None
depends_on = None


def upgrade():
    if op.get_context().config.attributes.get("workspace"):
        return
    if op.get_bind().execute(sa.text("SELECT 1 FROM accounts LIMIT 1")).first():
        raise RuntimeError("Start with a fresh DayWeave data volume for email registration.")
    op.add_column("accounts", sa.Column("email", sa.String(254), nullable=False))
    op.create_index("ux_accounts_email", "accounts", ["email"], unique=True)
    op.create_table(
        "email_challenges",
        sa.Column("email", sa.String(254), primary_key=True),
        sa.Column("purpose", sa.String(16), primary_key=True),
        sa.Column("digest", sa.String(64), nullable=False),
        sa.Column("issued_at", sa.Integer(), nullable=False),
        sa.Column("attempts", sa.Integer(), nullable=False),
    )
    op.create_index("ix_email_challenges_issued_at", "email_challenges", ["issued_at"])


def downgrade():
    if op.get_context().config.attributes.get("workspace"):
        return
    op.drop_table("email_challenges")
    op.drop_index("ux_accounts_email", table_name="accounts")
    op.drop_column("accounts", "email")
