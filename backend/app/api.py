from datetime import date

from fastapi import APIRouter, Depends, File, Form, Query, UploadFile
from sqlalchemy import select
from sqlalchemy.orm import Session

from .i18n import DomainError
from . import services
from .auth import require_admin
from .db import get_db
from .models import Project, Resource, Task, TaskChangeLog, now_iso
from .records import columns
from .schemas import SchedulePatch
from .uploads import open_file, store_upload

router = APIRouter(prefix="/api", dependencies=[Depends(require_admin)])


def commit(db, value):
    db.commit()
    return value


@router.get("/tasks")
def tasks(view: str = "all", q: str | None = Query(None, max_length=500), project_id: int | None = None,
          status: str | None = None, priority: str | None = None, category: str | None = None,
          scheduled_date: date | None = None, due_date: date | None = None, db: Session = Depends(get_db)):
    return services.list_tasks(db, view=view, q=q, project_id=project_id, status=status, priority=priority,
                               category=category, scheduled_date=scheduled_date, due_date=due_date)


@router.get("/planner/history")
def planner_history(start: date, end: date, db: Session = Depends(get_db)):
    if not 0 <= (end - start).days <= 62:
        raise DomainError(422, "time.invalid_date")
    return services.previous_day_plans(db, start, end)


@router.post("/tasks", status_code=201)
def create_task(data: dict, db: Session = Depends(get_db)):
    return commit(db, services.create_task(db, data))


@router.get("/tasks/{id}")
def task(id: int, db: Session = Depends(get_db)):
    return services.get_task(db, id)


@router.patch("/tasks/{id}")
def update_task(id: int, data: dict, db: Session = Depends(get_db)):
    return commit(db, services.update_task(db, id, data))


@router.patch("/tasks/{id}/schedule")
def schedule_task(id: int, data: SchedulePatch, db: Session = Depends(get_db)):
    return commit(db, services.schedule_task(db,id,data))


def confirmed(confirm):
    if not confirm:
        raise DomainError(409, "record.confirm_delete")


@router.delete("/tasks/{id}")
def delete_task(id: int, confirm: bool = False, db: Session = Depends(get_db)):
    confirmed(confirm)
    return commit(db, services.delete_task(db, id))


@router.get("/projects")
def projects(db: Session = Depends(get_db)):
    return services.list_projects(db)


@router.post("/projects", status_code=201)
def create_project(data: dict, db: Session = Depends(get_db)):
    return commit(db, services.create_project(db, data))


@router.get("/projects/{id}")
def project(id: int, db: Session = Depends(get_db)):
    return services.project_detail(db, id)


@router.patch("/projects/{id}")
def update_project(id: int, data: dict, db: Session = Depends(get_db)):
    return commit(db, services.update_project(db, id, data))


@router.delete("/projects/{id}")
def delete_project(id: int, confirm: bool = False, db: Session = Depends(get_db)):
    confirmed(confirm)
    return commit(db, services.soft_delete(db, Project, id))


@router.get("/resources")
def resources(q: str | None = Query(None, max_length=500), project_id: int | None = None,
              db: Session = Depends(get_db)):
    return services.list_resources(db, q=q, project_id=project_id)


@router.post("/resources", status_code=201)
def create_resource(data: dict, db: Session = Depends(get_db)):
    return commit(db, services.create_resource(db, data))


@router.post("/resources/upload", status_code=201)
async def upload(file: UploadFile = File(...), title: str | None = Form(None), db: Session = Depends(get_db)):
    return commit(db, await store_upload(db, file, title))


@router.get("/resources/{id}")
def resource(id: int, db: Session = Depends(get_db)):
    return services.get_resource(db, id)


@router.get("/resources/{id}/file")
def file(id: int, db: Session = Depends(get_db)):
    return open_file(db, id)


@router.patch("/resources/{id}")
def update_resource(id: int, data: dict, db: Session = Depends(get_db)):
    return commit(db, services.update_resource(db, id, data))


@router.delete("/resources/{id}")
def delete_resource(id: int, confirm: bool = False, db: Session = Depends(get_db)):
    confirmed(confirm)
    return commit(db, services.soft_delete(db, Resource, id))


@router.get("/dashboard/today")
def today(db: Session = Depends(get_db)):
    return services.dashboard(db)


@router.get("/settings")
def settings(db: Session = Depends(get_db)):
    return services.get_settings(db)


@router.patch("/settings")
def update_settings(data: dict, db: Session = Depends(get_db)):
    return commit(db, services.update_settings(db, data))


@router.get("/changes")
def changes(limit: int = Query(100, ge=1, le=1000), db: Session = Depends(get_db)):
    return services.list_changes(db, limit)


@router.post("/changes/{id}/undo")
def undo(id: int, db: Session = Depends(get_db)):
    return commit(db, services.undo(db, id))


@router.get("/export")
def export(db: Session = Depends(get_db)):
    from .ai.models import Conversation, Message
    return {"schema_version": 1, "exported_at": now_iso(), "settings": services.get_settings(db),
            "tasks": services.list_tasks(db), "projects": services.list_projects(db),
            "resources": services.list_resources(db),
            "conversations": [columns(r, exclude={"account_id"}) for r in db.scalars(select(Conversation).order_by(Conversation.id))],
            "messages": [columns(r, exclude={"tools", "account_id"}) for r in db.scalars(select(Message).order_by(Message.id))],
            "changes": list(reversed(services.list_changes(db, limit=None)))}
