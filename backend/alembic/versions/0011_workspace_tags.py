"""Add a reusable tag catalog and preserve existing task categories."""
from alembic import op
import sqlalchemy as sa

revision = "0011_workspace_tags"
down_revision = "0010_usage_and_deadline_period"
branch_labels = None
depends_on = None


def upgrade():
    tags = op.create_table(
        "tags", sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("name", sa.String(300), nullable=False),
        sa.Column("name_key", sa.String, nullable=False, unique=True),
    )
    links = op.create_table(
        "task_tags",
        sa.Column("task_id", sa.Integer, sa.ForeignKey("tasks.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("tag_id", sa.Integer, sa.ForeignKey("tags.id", ondelete="CASCADE"), primary_key=True),
    )
    op.create_index("ix_task_tags_tag_id", "task_tags", ["tag_id"])
    conn = op.get_bind()
    tasks = sa.table("tasks", sa.column("id", sa.Integer), sa.column("category", sa.String))
    catalog = {}
    for task_id, category in conn.execute(sa.select(tasks.c.id, tasks.c.category).order_by(tasks.c.id)):
        name = (category or "").strip()
        if not name:
            continue
        key = name.casefold()
        if key not in catalog:
            inserted = conn.execute(tags.insert().values(name=name, name_key=key))
            catalog[key] = (inserted.inserted_primary_key[0], name)
        tag_id, canonical = catalog[key]
        conn.execute(links.insert().values(task_id=task_id, tag_id=tag_id))
        if category != canonical:
            conn.execute(tasks.update().where(tasks.c.id == task_id).values(category=canonical))


def downgrade():
    op.drop_table("task_tags")
    op.drop_table("tags")
