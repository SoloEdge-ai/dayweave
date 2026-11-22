"""Preserve exact dates and add optional local week/month planning windows."""
import sqlalchemy as sa
from alembic import op

revision = "0005_planning_windows"
down_revision = "0004_task_drafts"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("tasks", sa.Column("planning_window", sa.String(), nullable=True))
    op.add_column("tasks", sa.Column("window_start", sa.Date(), nullable=True))
    op.create_index("ix_tasks_window_start", "tasks", ["window_start"])
    op.execute("UPDATE user_settings SET week_start=0 WHERE week_start <> 0")


def downgrade():
    op.drop_index("ix_tasks_window_start", table_name="tasks")
    op.drop_column("tasks","window_start")
    op.drop_column("tasks","planning_window")
