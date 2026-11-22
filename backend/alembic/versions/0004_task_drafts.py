"""Version editable AI task proposals independently from workspace tasks."""

import sqlalchemy as sa
from alembic import op

revision = "0004_task_drafts"
down_revision = "0003_ai_lease"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "ai_confirmations",
        sa.Column("version", sa.Integer(), nullable=False, server_default="1"),
    )


def downgrade():
    with op.batch_alter_table("ai_confirmations") as batch:
        batch.drop_column("version")
