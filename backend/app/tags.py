"""Workspace tag catalog shared by task edits, standalone creation and the assistant."""
from sqlalchemy import select

from .models import Tag
from .records import lock_for_write
from .schemas import TagInput


def list_tags(db):
    return [{"id": tag.id, "name": tag.name} for tag in db.scalars(select(Tag).order_by(Tag.name_key))]


def resolve_tags(db, names):
    # All callers hold the workspace write lock. Keep the first spelling of each name.
    by_key = {}
    for name in names:
        name = name.strip()
        if name:
            by_key.setdefault(name.casefold(), name)
    if not by_key:
        return []
    existing = {tag.name_key: tag for tag in db.scalars(select(Tag).where(Tag.name_key.in_(by_key)))}
    ordered = []
    for key, name in by_key.items():
        tag = existing.get(key)
        if tag is None:
            tag = Tag(name=name, name_key=key)
            db.add(tag)
        ordered.append(tag)
    return ordered


def create_tag(db, data: TagInput):
    lock_for_write(db)
    tag, = resolve_tags(db, [data.name])
    db.flush()
    return {"id": tag.id, "name": tag.name}
