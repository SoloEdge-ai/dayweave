from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from .i18n import DomainError


def local_today(zone: str, now=None):
    return (now or datetime.now(timezone.utc)).astimezone(ZoneInfo(zone)).date()


def week_bounds(day):
    first = day - timedelta(days=day.weekday())
    return first, first + timedelta(days=6)


def merge_schedule(previous, changes):
    """An exact slot, a period-only plan, and the inbox are mutually exclusive."""
    fields = dict(changes)
    if fields.get("due_at") or ("due_date" in fields and not fields["due_date"]):
        fields.setdefault("due_period", None)
    if fields.get("planning_window"):
        for key in ("scheduled_date", "scheduled_period", "planned_start_at", "planned_end_at"):
            fields.setdefault(key, None)
    elif "scheduled_date" in fields or fields.get("planned_start_at"):
        fields.setdefault("planning_window", None)
        fields.setdefault("window_start", None)
    elif "planning_window" in fields and fields["planning_window"] is None:
        fields.setdefault("window_start", None)
    if "scheduled_date" in fields and (str(fields["scheduled_date"]) != str(previous.get("scheduled_date")) or fields["scheduled_date"] is None):
        for key in ("scheduled_period", "planned_start_at", "planned_end_at"):
            fields.setdefault(key, None)
    return {**previous, **fields}


def apply_time_rules(task, zone: str, check_due=True):
    tz = ZoneInfo(zone)
    if task.planned_start_at:
        start_day = task.planned_start_at.astimezone(tz).date()
        if task.scheduled_date and task.scheduled_date != start_day:
            raise DomainError(422, "time.local_date_mismatch")
        task.scheduled_date = start_day
    if not check_due or task.allow_due_conflict or not (task.scheduled_date or task.window_start):
        return
    deadline = task.due_date or (task.due_at and task.due_at.astimezone(tz).date())
    scheduled_end = task.planned_end_at or task.planned_start_at
    scheduled_day = scheduled_end.astimezone(tz).date() if scheduled_end else task.scheduled_date or task.window_start
    periods = ("morning", "afternoon", "evening")
    if (scheduled_day == deadline and task.scheduled_period and task.due_period and not scheduled_end
            and periods.index(task.scheduled_period) > periods.index(task.due_period)):
        raise DomainError(409, "time.due_conflict")
    if (deadline and scheduled_day > deadline) or (scheduled_end and task.due_at and scheduled_end > task.due_at):
        raise DomainError(409, "time.due_conflict")
