"""Fence abandoned streaming requests so they can safely resume."""

import sqlalchemy as sa
from alembic import op

revision = "0003_ai_lease"
down_revision = "0002_ai"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "ai_turns", sa.Column("lease", sa.String(), nullable=False, server_default="")
    )
    op.add_column(
        "ai_turns",
        sa.Column("lease_until", sa.Integer(), nullable=False, server_default="0"),
    )


def downgrade():
    with op.batch_alter_table("ai_turns") as batch:
        batch.drop_column("lease_until")
        batch.drop_column("lease")
