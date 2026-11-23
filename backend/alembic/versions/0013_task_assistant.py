"""Store personal task continuation notes and task-bound conversations."""
import sqlalchemy as sa
from alembic import op

revision = "0013_task_assistant"
down_revision = "0012_task_primary_resource"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "task_resume_notes",
        sa.Column("account_id", sa.String(36), primary_key=True),
        sa.Column("task_id", sa.Integer, sa.ForeignKey("tasks.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("text", sa.Text, nullable=False),
        sa.Column("updated_at", sa.String, nullable=False),
    )
    op.execute("ALTER TABLE conversations ADD COLUMN task_id INTEGER REFERENCES tasks(id) ON DELETE CASCADE")
    op.create_index("ix_conversations_account_task", "conversations", ["account_id", "task_id"], unique=True)


def downgrade():
    op.drop_index("ix_conversations_account_task", table_name="conversations")
    op.drop_column("conversations", "task_id")
    op.drop_table("task_resume_notes")
