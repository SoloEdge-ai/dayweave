"""Add the optional work entry point to existing tasks."""
from alembic import op

revision = "0012_task_primary_resource"
down_revision = "0011_workspace_tags"
branch_labels = None
depends_on = None


def upgrade():
    # An inline nullable reference preserves existing SQLite task and attachment rows.
    op.execute("ALTER TABLE tasks ADD COLUMN primary_resource_id INTEGER REFERENCES resources(id) ON DELETE SET NULL")


def downgrade():
    op.drop_column("tasks", "primary_resource_id")
