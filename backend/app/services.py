"""Business operations shared by REST routes and agent tools.

Callers own the transaction. Commands validate, modify and audit atomically.
"""
from calendar import monthrange
from datetime import date, datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo

from .i18n import DomainError, normalize_language
from sqlalchemy import or_, select
from sqlalchemy.orm import selectinload

from .models import CalendarSettings, Project, Resource, Settings, Tag, Task, TaskChangeLog, now_iso
from .records import KINDS, active, audit, columns, finish, links, lock_for_write, snapshot
from .schemas import ProjectInput, ResourceInput, SettingsInput, TaskInput
from .tags import resolve_tags
from .time_rules import apply_time_rules, local_today, merge_schedule, week_bounds


def get_settings(db):
    row = db.get(Settings, 1)
    if row is None:
        lock_for_write(db)
        row = db.get(Settings, 1, populate_existing=True)
        if row is None:
            row = Settings(id=1)
            db.add(row)
            db.flush()
    values = columns(row, exclude={"id"})
    values["language"] = normalize_language(row.language)
    if db.info.get("workspace_id"):
        calendar = db.get(CalendarSettings, 1)
        values["timezone"] = calendar.timezone if calendar else "Asia/Hong_Kong"
    return values


def update_settings(db, data, *, source="manual", conversation_id=None, record_change=True):
    lock_for_write(db)
    previous = get_settings(db)
    values = SettingsInput.model_validate({**previous, **data})
    row = db.get(Settings, 1)
    for key, value in values.model_dump().items():
        if key == "timezone" and db.info.get("workspace_id"):
            if value != previous["timezone"]:
                if not db.info["workspace_owner"]:
                    raise DomainError(403, "workspace.calendar_owner")
                calendar = db.get(CalendarSettings, 1)
                if calendar is None:
                    calendar = CalendarSettings(id=1)
                    db.add(calendar)
                calendar.timezone = value
            continue
        setattr(row, key, value)
    db.flush()
    if previous["timezone"] != values.timezone:
        zone = ZoneInfo(values.timezone)
        timed_tasks = select(Task).where(Task.deleted.is_(False), Task.planned_start_at.is_not(None))
        for task in db.scalars(timed_tasks):
            local_day = datetime.fromisoformat(task.planned_start_at).astimezone(zone).date()
            if task.scheduled_date != local_day:
                # This index follows the absolute start instant in the display zone.
                task.scheduled_date = local_day
        db.flush()
    after=get_settings(db)
    if previous!=after and record_change:
        db.add(TaskChangeLog(entity_type="settings",entity_id=1,action="update",before=previous,after=after,
                             source=source,conversation_id=conversation_id,actor_id=db.info.get("account_id")))
        db.flush()
    return after


def _fields(previous, schema):
    return {k: v for k, v in (previous or {}).items() if k in schema.model_fields}


def _write_task(db, row, data, source, conversation_id, *, include_change=False):
    before = snapshot(row) if row.id else None
    merged = merge_schedule(_fields(before, TaskInput),data)
    if data.get("due_at") and "due_date" not in data:
        merged["due_date"] = None
    if data.get("due_date") and "due_at" not in data:
        merged["due_at"] = None
    if "category" in data and "tags" not in data:
        extra = (before or {}).get("tags", [])[1:]
        name = data["category"]
        if isinstance(name, str):
            merged["tags"] = ([name.strip()] if name.strip() else []) + extra
    task = TaskInput.model_validate(merged)
    temporal = {"scheduled_date", "planned_start_at", "planned_end_at", "due_date", "due_at", "scheduled_period", "due_period", "planning_window", "window_start"}
    changed_time = any((before or {}).get(k) != merged.get(k) for k in temporal)
    apply_time_rules(task, get_settings(db)["timezone"], check_due=changed_time)
    if task.project_id:
        active(db, Project, task.project_id)
    row.resources = links(db, Resource, task.resource_ids)
    if before is None or "tags" in data or "category" in data:
        row.tags = resolve_tags(db, task.tags)
        task.category = row.tags[0].name if row.tags else ""
    for key, value in task.model_dump(exclude={"tags", "resource_ids", "allow_due_conflict"}).items():
        setattr(row, key, value.isoformat(timespec="microseconds") if isinstance(value, datetime) else value)
    row.completed_at = (row.completed_at or now_iso()) if row.status == "done" else None
    db.add(row)
    return finish(db, row, before, source, conversation_id, include_change=include_change)


def create_task(db, data, *, source="manual", conversation_id=None):
    lock_for_write(db)
    return _write_task(db, Task(), data, source, conversation_id)


def update_task(db, id, data, *, source="manual", conversation_id=None):
    lock_for_write(db)
    return _write_task(db, active(db, Task, id), data, source, conversation_id)


def schedule_task(db, id, patch):
    lock_for_write(db)
    row = active(db, Task, id)
    db.refresh(row)
    if row.updated_at != patch.expected_updated_at:
        raise DomainError(409, "task.stale_schedule")
    changes = patch.model_dump(mode="json", exclude_unset=True, exclude={"expected_updated_at"})
    if not changes.keys() - {"allow_due_conflict"}:
        raise DomainError(422, "task.schedule_empty")
    task, change_id = _write_task(db,row,changes,"manual",None,include_change=True)
    return {"task":task,"change_id":change_id}


def release_elapsed_days(db):
    """Close elapsed assignments without copying or completing their tasks."""
    zone = get_settings(db)["timezone"]
    today = local_today(zone)
    midnight = datetime.combine(today, time(), ZoneInfo(zone)).astimezone(timezone.utc).isoformat(timespec="microseconds")
    elapsed = (Task.deleted.is_(False), Task.status.in_(("todo", "in_progress")), Task.scheduled_date < today,
               or_(Task.planned_end_at.is_(None), Task.planned_end_at < midnight))
    if db.scalar(select(Task.id).where(*elapsed).limit(1)) is None:
        return
    lock_for_write(db)
    for task in db.scalars(select(Task).options(selectinload(Task.resources)).where(*elapsed)):
        before = snapshot(task)
        task.scheduled_date = task.scheduled_period = task.planned_start_at = task.planned_end_at = None
        task.updated_at = now_iso()
        audit(db, task, "day_released", before, snapshot(task), "calendar", None)
    db.commit()


def previous_day_plans(db, start, end):
    day = TaskChangeLog.before["scheduled_date"].as_string()
    rows = db.scalars(select(TaskChangeLog).join(Task, Task.id == TaskChangeLog.entity_id).where(
        Task.deleted.is_(False), TaskChangeLog.entity_type == "task", TaskChangeLog.action == "day_released",
        day.between(start.isoformat(), end.isoformat()),
        or_(Task.scheduled_date.is_(None), Task.scheduled_date != day),
    ).order_by(TaskChangeLog.id))
    # Reassigning the same task to the same past date updates the day's display once.
    visits = {}
    for row in rows:
        record = row.before
        visits[(record["scheduled_date"], row.entity_id)] = {**record, "is_past_plan": True}
    return list(visits.values())


def get_task(db, id):
    return snapshot(active(db, Task, id))


def list_tasks(db, *, view="all", q=None, project_id=None, status=None, priority=None,
               category=None, scheduled_date=None, due_date=None):
    settings = get_settings(db)
    today = local_today(settings["timezone"])
    tomorrow = today + timedelta(days=1)
    week_start, week_end = week_bounds(today)
    following = week_start + timedelta(days=7)
    month_start = today.replace(day=1)
    month_end = today.replace(day=monthrange(today.year,today.month)[1])

    def week_filter(start):
        return or_(Task.scheduled_date.between(start,start+timedelta(days=6)),
                   (Task.planning_window=="week") & (Task.window_start==start))

    views = {
        "all": (), "inbox": (Task.scheduled_date.is_(None), Task.planning_window.is_(None), Task.status.in_(("todo", "in_progress"))),
        "today": (Task.scheduled_date == today,), "tomorrow": (Task.scheduled_date == tomorrow,),
        "week": (week_filter(week_start),), "next_week":(week_filter(following),),
        "month": (or_(Task.scheduled_date.between(month_start,month_end),
                      (Task.planning_window=="month") & (Task.window_start==month_start),
                      (Task.planning_window=="week") & Task.window_start.between(month_start-timedelta(days=6),month_end)),),
        "upcoming": (Task.scheduled_date >= tomorrow, Task.status.in_(("todo", "in_progress"))),
        "completed": (Task.status == "done",),
    }
    if view not in views:
        raise DomainError(422, "task.unknown_view")
    stmt = select(Task).options(selectinload(Task.resources)).where(Task.deleted.is_(False), *views[view])
    if category:
        stmt = stmt.where(Task.tags.any(Tag.name_key == category.strip().casefold()))
    if q:
        stmt = stmt.where(or_(Task.title.contains(q, autoescape=True), Task.description.contains(q, autoescape=True)))
    for key, value in (("project_id", project_id), ("status", status), ("priority", priority),
                       ("scheduled_date", scheduled_date), ("due_date", due_date)):
        if value is not None:
            if key in {"scheduled_date", "due_date"} and isinstance(value, str):
                try:
                    value = date.fromisoformat(value)
                except ValueError:
                    raise DomainError(422, "time.invalid_date")
            if key == "due_date":
                zone = ZoneInfo(settings["timezone"])
                start = datetime.combine(value, time(), zone).astimezone(timezone.utc)
                end = datetime.combine(value + timedelta(days=1), time(), zone).astimezone(timezone.utc)
                stmt = stmt.where(or_(Task.due_date == value,
                    (Task.due_at >= start.isoformat(timespec="microseconds")) &
                    (Task.due_at < end.isoformat(timespec="microseconds"))))
            else:
                stmt = stmt.where(getattr(Task, key) == value)
    return [snapshot(r) for r in db.scalars(stmt.order_by(Task.id.desc()))]


def _project(db, row, data, source, conversation_id):
    before = snapshot(row) if row.id else None
    fields = ProjectInput.model_validate({**_fields(before, ProjectInput), **data})
    for key, value in fields.model_dump().items():
        setattr(row, key, value)
    db.add(row)
    return finish(db, row, before, source, conversation_id)


def create_project(db, data, *, source="manual", conversation_id=None):
    lock_for_write(db)
    return _project(db, Project(), data, source, conversation_id)


def update_project(db, id, data, *, source="manual", conversation_id=None):
    lock_for_write(db)
    return _project(db, active(db, Project, id), data, source, conversation_id)


def list_projects(db):
    return [snapshot(p) for p in db.scalars(select(Project).where(Project.deleted.is_(False)).order_by(Project.id.desc()))]


def project_detail(db, id):
    return {**snapshot(active(db, Project, id)), "tasks": list_tasks(db, project_id=id),
            "resources": list_resources(db, project_id=id)}


def _resource(db, row, data, source, conversation_id, *, reuse=False):
    before = snapshot(row) if row.id else None
    merged = {**_fields(before, ResourceInput), **data}
    if before and "type" in data and data["type"] != before["type"] and "position_unit" not in data:
        merged["position_unit"] = None
    value = ResourceInput.model_validate(merged)
    if not value.url and not row.file_path:
        raise DomainError(422, "resource.location_required")
    if value.url:
        duplicate = db.scalar(select(Resource).where(Resource.url == value.url))
        if duplicate is not None and duplicate != row:
            if reuse and not duplicate.deleted:
                return snapshot(duplicate)
            if not (reuse and duplicate.deleted):
                raise DomainError(409, "resource.duplicate_url")
            # The earlier deletion remains undoable until this URL is reused.
            row = duplicate
            row.deleted = False
    row.projects = links(db, Project, value.project_ids)
    for key, field in value.model_dump(exclude={"project_ids"}).items():
        setattr(row, key, field)
    db.add(row)
    return finish(db, row, before, source, conversation_id)


def create_resource(db, data, *, source="manual", conversation_id=None):
    lock_for_write(db)
    return _resource(db, Resource(), data, source, conversation_id, reuse=True)


def create_uploaded_resource(db, data, stored_name, original_name):
    lock_for_write(db)
    row = Resource(file_path=stored_name, original_filename=original_name)
    return _resource(db, row, data, "manual", None)


def update_resource(db, id, data, *, source="manual", conversation_id=None):
    lock_for_write(db)
    return _resource(db, active(db, Resource, id), data, source, conversation_id)


def get_resource(db, id):
    return snapshot(active(db, Resource, id))


def list_resources(db, *, q=None, project_id=None):
    stmt = select(Resource).where(Resource.deleted.is_(False)).options(selectinload(Resource.projects))
    if q:
        stmt = stmt.where(or_(Resource.title.contains(q, autoescape=True), Resource.url.contains(q, autoescape=True)))
    if project_id is not None:
        stmt = stmt.where(Resource.projects.any(Project.id == project_id))
    return [snapshot(r) for r in db.scalars(stmt.order_by(Resource.id.desc()))]


def _ensure_unlinked(db, row):
    if isinstance(row, Project):
        tasks = select(Task.id).where(Task.deleted.is_(False), Task.project_id == row.id)
        resources = select(Resource.id).where(Resource.deleted.is_(False), Resource.projects.any(Project.id == row.id))
        if db.scalar(tasks.limit(1)) or db.scalar(resources.limit(1)):
            raise DomainError(409, "project.in_use")
    if isinstance(row, Resource):
        tasks = select(Task.id).where(Task.deleted.is_(False), Task.resources.any(Resource.id == row.id))
        if db.scalar(tasks.limit(1)):
            raise DomainError(409, "resource.in_use")


def soft_delete(db, model, id, *, source="manual", conversation_id=None):
    lock_for_write(db)
    row = active(db, model, id)
    _ensure_unlinked(db, row)
    before = snapshot(row)
    row.deleted = True
    row.updated_at = now_iso()
    audit(db, row, "delete", before, None, source, conversation_id)
    return {"id": id, "deleted": True}


def delete_task(db, id, *, source="manual", conversation_id=None):
    return soft_delete(db, Task, id, source=source, conversation_id=conversation_id)


def list_changes(db, limit=100):
    query = select(TaskChangeLog).order_by(TaskChangeLog.id.desc())
    actor = db.info.get("account_id")
    if actor:
        query = query.where(or_(TaskChangeLog.entity_type != "settings", TaskChangeLog.actor_id == actor))
    if limit is not None:
        query = query.limit(limit)
    return [columns(row, exclude={"conversation_id"} if actor and row.actor_id != actor else ()) for row in db.scalars(query)]


def undo(db, id, *, source="manual", conversation_id=None):
    lock_for_write(db)
    entry = db.get(TaskChangeLog, id)
    actor = db.info.get("account_id")
    if (not entry or entry.undone_at or entry.action in {"undo", "day_released"} or
            (actor and entry.entity_type == "settings" and entry.actor_id != actor)):
        raise DomainError(409, "history.cannot_undo")
    query = select(TaskChangeLog.id).where(
        TaskChangeLog.entity_type == entry.entity_type, TaskChangeLog.entity_id == entry.entity_id,
        TaskChangeLog.undone_at.is_(None), TaskChangeLog.action != "undo",
    )
    if actor and entry.entity_type == "settings":
        query = query.where(TaskChangeLog.actor_id == actor)
    latest = db.scalar(query.order_by(TaskChangeLog.id.desc()).limit(1))
    if latest != entry.id:
        raise DomainError(409, "history.newer_change")
    if entry.entity_type=="settings":
        before=get_settings(db)
        restore = dict(entry.before)
        if actor and not db.info["workspace_owner"]:
            restore.pop("timezone", None)
        restored=update_settings(db,restore,record_change=False)
        entry.undone_at=now_iso()
        db.add(TaskChangeLog(entity_type="settings",entity_id=1,action="undo",before=before,after=restored,
                             source=source,conversation_id=conversation_id,actor_id=actor))
        db.flush()
        return {"id":entry.id,"undone":True,"record":restored}
    model = next(cls for cls, name in KINDS.items() if name == entry.entity_type)
    row = db.get(model, entry.entity_id)
    before = None if row.deleted else snapshot(row)
    restore = entry.before
    if restore is None:
        _ensure_unlinked(db, row)
        row.deleted = True
    else:
        if model is Task:
            if restore["project_id"]:
                active(db, Project, restore["project_id"])
            row.resources = links(db, Resource, restore["resource_ids"])
            names = restore.get("tags", [restore["category"]] if restore.get("category","").strip() else [])
            row.tags = resolve_tags(db, names)
            restore = {**restore, "category": row.tags[0].name if row.tags else ""}
        if model is Resource:
            row.projects = links(db, Project, restore["project_ids"])
            if restore["url"]:
                conflict = db.scalar(select(Resource.id).where(Resource.url == restore["url"], Resource.id != row.id))
                if conflict:
                    raise DomainError(409, "resource.url_taken")
        for col in row.__table__.columns:
            if col.name in restore and col.name not in {"id", "created_at", "updated_at"}:
                value = restore[col.name]
                if value is not None and col.name in {"scheduled_date", "due_date", "target_date", "window_start"}:
                    value = date.fromisoformat(value)
                setattr(row, col.name, value)
        if model is Task and row.planned_start_at:
            zone = ZoneInfo(get_settings(db)["timezone"])
            row.scheduled_date = datetime.fromisoformat(row.planned_start_at).astimezone(zone).date()
        row.deleted = False
    entry.undone_at = row.updated_at = now_iso()
    db.flush()
    after = None if row.deleted else snapshot(row)
    audit(db, row, "undo", before, after, source, conversation_id)
    return {"id": entry.id, "undone": True, "record": after}


def dashboard(db):
    settings = get_settings(db)
    zone = ZoneInfo(settings["timezone"])
    now = datetime.now(timezone.utc)
    day = now.astimezone(zone).date()
    tasks = list_tasks(db, view="today")
    active_tasks = [t for t in list_tasks(db) if t["status"] in {"todo", "in_progress"}]
    output = {"date": day.isoformat(), "tasks": tasks, "focus": [], "resources": [],
              "due_today": [], "due_soon": [], "overdue": [], "missed": []}
    weights = {"high": 0, "medium": 1, "low": 2}
    released = select(TaskChangeLog.entity_id).where(TaskChangeLog.entity_type == "task", TaskChangeLog.action == "day_released")
    returned = set(db.scalars(select(Task.id).where(Task.id.in_(released), Task.scheduled_date.is_(None),
                        Task.planning_window.is_(None), Task.status.in_(("todo", "in_progress")), Task.deleted.is_(False))))
    for task in active_tasks:
        if task["id"] in returned:
            output["missed"].append(task)
        exact = datetime.fromisoformat(task["due_at"]) if task["due_at"] else None
        deadline = exact.astimezone(zone).date() if exact else date.fromisoformat(task["due_date"]) if task["due_date"] else None
        if deadline:
            if deadline < day or (exact and exact < now):
                output["overdue"].append(task)
            elif deadline == day:
                output["due_today"].append(task)
            elif deadline <= day + timedelta(days=7):
                output["due_soon"].append(task)
    current = [t for t in tasks if t["status"] in {"todo", "in_progress"}]
    output["focus"] = sorted(current, key=lambda t: (not t["pinned"], weights[t["priority"]], t["due_date"] or t["due_at"] or "z", t["id"]))[:3]
    resource_tasks = {}
    for task in current:
        for rid in task["resource_ids"]:
            resource_tasks.setdefault(rid, []).append(task["id"])
    output["resources"] = [{**snapshot(r), "task_ids": resource_tasks[r.id]} for r in
                           links(db, Resource, resource_tasks)]
    return output
