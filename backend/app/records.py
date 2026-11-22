from datetime import date

from .i18n import DomainError
from sqlalchemy import select

from .models import Project, Resource, Task, TaskChangeLog, now_iso


def lock_for_write(db):
    # sqlite3's legacy transaction mode starts transactions on DML only.
    # Reserve the writer before reading a snapshot used for mutation or undo.
    connection = db.connection()
    if not connection.connection.driver_connection.in_transaction:
        connection.exec_driver_sql("BEGIN IMMEDIATE")


def active(db, model, record_id):
    row = db.get(model, record_id)
    if row is None or row.deleted:
        raise DomainError(404, "record.missing")
    return row


def links(db, model, ids):
    if not ids:
        return []
    rows = list(db.scalars(select(model).where(model.id.in_(ids), model.deleted.is_(False)).order_by(model.id)))
    if len(rows) != len(set(ids)):
        raise DomainError(422, "record.links_missing")
    return rows


def columns(row, *, exclude=()):
    result = {}
    for col in row.__table__.columns.keys():
        if col not in exclude:
            value = getattr(row, col)
            result[col] = value.isoformat() if isinstance(value, date) else value
    return result


def snapshot(row):
    result = columns(row, exclude={"deleted", "file_path"})
    if isinstance(row, Task):
        result["resource_ids"] = sorted(r.id for r in row.resources if not r.deleted)
    if isinstance(row, Resource):
        result["project_ids"] = sorted(p.id for p in row.projects if not p.deleted)
        result["file_url"] = f"/api/resources/{row.id}/file" if row.file_path else None
    return result


KINDS = {Task: "task", Resource: "resource", Project: "project"}


def audit(db, row, action, before, after, source, conversation_id):
    entry = TaskChangeLog(
        entity_type=KINDS[type(row)], entity_id=row.id, action=action, before=before,
        after=after, source=source, conversation_id=conversation_id,
    )
    db.add(entry)
    db.flush()
    return entry.id


def finish(db, row, before, source, conversation_id, *, include_change=False):
    db.flush()
    after = snapshot(row)
    change_id = None
    if before != after:
        row.updated_at = now_iso()
        after["updated_at"] = row.updated_at
        change_id = audit(db, row, "create" if before is None else "update", before, after, source, conversation_id)
    return (after, change_id) if include_change else after
