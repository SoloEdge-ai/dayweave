"""Keep provider-reported usage with each reply and preserve deadline day parts."""
from alembic import op
import sqlalchemy as sa

revision = "0010_usage_and_deadline_period"
down_revision = "0009_email_delivery"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("messages", sa.Column("token_usage", sa.JSON(), nullable=True))
    op.add_column("tasks", sa.Column("due_period", sa.String(), nullable=True))


def downgrade():
    op.drop_column("tasks", "due_period")
    op.drop_column("messages", "token_usage")
