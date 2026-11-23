"""Personal continuation notes for tasks in the active workspace."""
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from .i18n import DomainError
from .models import Task, TaskResumeNote, now_iso
from .records import active, lock_for_write, snapshot


def record(db, task_id):
    actor = db.info.get("account_id")
    if not actor:
        raise DomainError(401, "auth.required")
    return db.get(TaskResumeNote, (actor, task_id))


def value(note):
    return {"text": note.text, "updated_at": note.updated_at} if note else {"text": "", "updated_at": None}


def get_note(db, task_id):
    active(db, Task, task_id)
    return value(record(db, task_id))


def list_notes(db):
    actor = db.info.get("account_id")
    rows = db.execute(select(TaskResumeNote, Task).join(Task, Task.id == TaskResumeNote.task_id)
        .options(selectinload(Task.resources)).where(
        TaskResumeNote.account_id == actor, TaskResumeNote.text != "", Task.deleted.is_(False),
    ).order_by(TaskResumeNote.updated_at.desc(), Task.id.desc()))
    return [{"task": snapshot(task), **value(note)} for note, task in rows]


def save_note(db, task_id, text, expected_updated_at):
    lock_for_write(db)
    active(db, Task, task_id)
    note = record(db, task_id)
    current = value(note)
    if current["text"] == text:
        return current
    if current["updated_at"] != expected_updated_at:
        raise DomainError(409, "task.resume_conflict")
    if note is None:
        note = TaskResumeNote(account_id=db.info["account_id"], task_id=task_id)
        db.add(note)
    note.text = text
    note.updated_at = now_iso()
    db.flush()
    return value(note)
