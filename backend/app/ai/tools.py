"""Bounded, validated domain tools. The model cannot call SQL or arbitrary URLs."""

import re
from datetime import date, datetime, timedelta
from typing import Literal
from zoneinfo import ZoneInfo

from fastapi import HTTPException
from pydantic import BaseModel, ConfigDict, Field

from app import services
from app.schemas import TagInput, TagNames
from app.tags import create_tag, list_tags
from app.time_rules import week_bounds
from . import workspace_tools


class Params(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class TaskFields(Params):
    title: str | None = Field(None, min_length=1, max_length=240)
    description: str | None = Field(None, max_length=4000)
    priority: Literal["low", "medium", "high"] | None = None
    tags: TagNames | None = Field(None, description="Full set of workspace tag names. Preserve existing tags when adding one.")
    category: str | None = None
    project_id: int | None = Field(None, gt=0)
    estimated_minutes: int | None = Field(None, ge=1, le=10080)
    scheduled_date: str | None = None
    planning_window: Literal["week","month"] | None = None
    window_start: str | None = None
    scheduled_period: Literal["morning", "afternoon", "evening"] | None = None
    planned_start_at: str | None = None
    planned_end_at: str | None = None
    due_date: str | None = None
    due_period: Literal["morning", "afternoon", "evening"] | None = None
    due_at: str | None = None
    resource_ids: list[int] | None = Field(None, max_length=20)
    status: Literal["todo", "in_progress", "done", "cancelled"] | None = None


class Create(TaskFields):
    title: str = Field(min_length=1, max_length=240)


class Target(Params):
    query: str = Field(
        min_length=1,
        max_length=240,
        description="Target words used by the user or #ID explicitly selected by the user. Multiple matches require clarification.",
    )
    on_date: str | None = Field(
        None,
        description="Only when the user identifies the task by its existing scheduled date.",
    )


class TaskEditFields(TaskFields):
    pinned: bool | None = None


class Update(Target):
    changes: TaskEditFields


class Schedule(Target):
    scheduled_date: str | None = None
    scheduled_period: Literal["morning", "afternoon", "evening"] | None = None
    planning_window: Literal["week","month"] | None = None
    window_start: str | None = None
    planned_start_at: str | None = None
    planned_end_at: str | None = None


class Search(Params):
    category: str | None = Field(None, description="Match any attached tag by name.")
    q: str | None = Field(None, max_length=200)
    view: Literal[
        "all", "inbox", "today", "tomorrow", "week", "next_week", "month", "upcoming", "completed"
    ] = "all"
    status: Literal["todo", "in_progress", "done", "cancelled"] | None = None


class ByDate(Params):
    date: str


class Project(Params):
    name: str = Field(min_length=1, max_length=160)
    description: str | None = None
    target_date: str | None = None


class Resource(Params):
    title: str = Field(min_length=1, max_length=240)
    url: str = Field(max_length=2000)
    type: Literal["video", "web", "pdf", "markdown", "other"]
    source: str | None = None
    reason: str | None = None
    project_ids: list[int] = Field(default_factory=list, max_length=20)


class ResourceSearch(Params):
    q: str = Field(max_length=200)


class Link(Target):
    resource_id: int = Field(gt=0)


class Watch(Resource):
    task_title: str = Field(min_length=1, max_length=240)
    scheduled_date: str | None = None
    planning_window: Literal["week","month"] | None = None
    window_start: str | None = None
    scheduled_period: Literal["morning", "afternoon", "evening"] | None = None
    due_date: str | None = None
    due_period: Literal["morning", "afternoon", "evening"] | None = None
    due_at: str | None = None
    estimated_minutes: int | None = Field(None, gt=0, le=525600)
    priority: Literal["low", "medium", "high"] | None = None
    category: str | None = None
    tags: TagNames | None = None
    task_description: str | None = None
    task_project_id: int | None = Field(None, gt=0)


class Plan(ByDate):
    available_minutes: int = Field(ge=1, le=1440)


DEFINITIONS = {
    "create_task": (
        Create,
        "Draft one task for a separate human confirmation. Omit unknown dates. Preserve deadline day parts in due_period and execution day parts in scheduled_period.",
    ),
    "get_task": (Target, "Resolve a user's task by name or #ID."),
    "search_tasks": (
        Search,
        "Query actual tasks and recent work. Use before answering factual task questions.",
    ),
    "update_task": (
        Update,
        "Modify one uniquely matching task. Preserve the user's own target wording.",
    ),
    "complete_task": (Target, "Complete one uniquely matching task."),
    "delete_task": (Target, "Propose deletion for explicit human review."),
    "list_tasks_by_date": (ByDate, "Query tasks scheduled on a local calendar day."),
    "create_project": (Project, "Create a project."),
    "create_tag": (TagInput, "Create or reuse a tag in the current workspace."),
    "list_tags": (Params, "List reusable tags in the current workspace."),
    "list_projects": (Params, "List local projects."),
    "create_resource": (Resource, "Save or reuse a URL without fetching its contents."),
    "search_resources": (ResourceSearch, "Find resources by keyword."),
    "link_resource_to_task": (
        Link,
        "Attach a saved resource to a uniquely identified task.",
    ),
    "schedule_task": (
        Schedule,
        "Change a uniquely identified task's plan independently of its deadline.",
    ),
    "generate_daily_plan": (
        Plan,
        "Read unfinished tasks and propose a priority-ordered allocation within available minutes. Does not write.",
    ),
    "save_and_schedule_resource": (
        Watch,
        "Prepare a linked resource/task draft; the separate human confirmation atomically saves the resource and task.",
    ),
}
READ = {
    "get_task",
    "search_tasks",
    "list_tasks_by_date",
    "list_projects",
    "list_tags",
    "search_resources",
    "generate_daily_plan",
}
DEFINITIONS.update(workspace_tools.DEFINITIONS)
READ.update(workspace_tools.READ)


def functions():
    result = []
    for name, (cls, description) in DEFINITIONS.items():
        schema = cls.model_json_schema()
        # Inline Pydantic refs so nested definitions also work with compatible endpoints.
        definitions = schema.pop("$defs", {})

        def inline(node, definitions=definitions):
            if isinstance(node, list):
                return [inline(v) for v in node]
            if isinstance(node, dict):
                if "$ref" in node:
                    return inline(definitions[node["$ref"].split("/")[-1]])
                return {
                    k: inline(v)
                    for k, v in node.items()
                    if k not in ("default", "title")
                    or k == "title"
                    and isinstance(v, dict)
                }
            return node

        result.append(
            {"name": name, "description": description, "parameters": inline(schema)}
        )
    return result


def resolve_day(value, today):
    if value is None:
        return None
    value = str(value).strip().lower()
    relative = {
        "今天": 0,
        "今日": 0,
        "明天": 1,
        "明日": 1,
        "后天": 2,
        "昨天": -1,
        "today": 0,
        "tomorrow": 1,
        "yesterday": -1,
        "day after tomorrow": 2,
        "the day after tomorrow": 2,
        "tonight": 0,
        "あした": 1,
        "明後日": 2,
        "あさって": 2,
        "昨日": -1,
        "今夜": 0,
    }
    if value in relative:
        return (today + timedelta(days=relative[value])).isoformat()
    japanese = re.fullmatch(r"(来週|今週)?の?([月火水木金土日])曜(?:日)?", value)
    english = re.fullmatch(
        r"(?:(next|this)\s+)?(monday|tuesday|wednesday|thursday|friday|saturday|sunday)",
        value,
    )
    if japanese or english:
        match = japanese or english
        index = (
            "月火水木金土日".index(match[2])
            if japanese
            else [
                "monday",
                "tuesday",
                "wednesday",
                "thursday",
                "friday",
                "saturday",
                "sunday",
            ].index(match[2])
        )
        offset = index - today.weekday()
        if match[1] in ("next", "来週") or (not match[1] and offset < 0):
            offset += 7
        return (today + timedelta(days=offset)).isoformat()
    match = re.fullmatch(r"(下|本|这)?(?:周|星期)([一二三四五六日天])", value)
    if match:
        day = "一二三四五六日".index(match[2].replace("天", "日"))
        offset = day - today.weekday()
        if match[1] == "下" or match[1] is None and offset < 0:
            offset += 7
        return (today + timedelta(days=offset)).isoformat()
    if re.fullmatch(r"\d{4}-\d{2}-\d{2}", value):
        try:
            return date.fromisoformat(value).isoformat()
        except ValueError:
            pass
    raise HTTPException(422, f"请明确日期「{value[:40]}」后再保存。")


def local_day(db):
    return datetime.now(ZoneInfo(services.get_settings(db)["timezone"])).date()


def named_window(text,today):
    """A named period has an anchor but no execution date."""
    pattern = (r"\b(this|next)\s+(week|month)\b|"
               r"(本周|这周|下周|本星期|这个星期|下星期|下个星期)(?![一二三四五六日天])|"
               r"(本月|这个月|下个月|下月)|"
               r"(今週|来週)(?!の?[月火水木金土日]曜)|(今月|来月)")
    match=re.search(pattern,text,re.IGNORECASE)
    if not match:
        return None
    term=match.group().lower()
    if re.search(r"week|周|週|星期",term):
        start=week_bounds(today)[0]
        return "week",(start+timedelta(days=7) if re.search(r"next|下|来",term) else start).isoformat()
    start=today.replace(day=1)
    if re.search(r"next|下|来",term):
        start=(start+timedelta(days=32)).replace(day=1)
    return "month",start.isoformat()


def normalize_dates(data, today):
    return {
        k: resolve_day(v, today)
        if k in ("due_date", "scheduled_date", "window_start", "target_date", "on_date", "date")
        else v
        for k, v in data.items()
    }


def identify(db, args, today):
    query = args["query"].strip()
    if re.fullmatch(r"#\d+", query):
        return services.get_task(db, int(query[1:]))
    rows = services.list_tasks(
        db, q=query, scheduled_date=resolve_day(args.get("on_date"), today)
    )
    if not rows:
        raise HTTPException(404, "没有找到匹配的任务，请补充任务名称。")
    if len(rows) > 1:
        labels = "、".join(f"#{r['id']} {r['title']}" for r in rows[:6])
        raise HTTPException(409, f"有多个匹配任务，请选择编号：{labels}")
    return rows[0]


def brief(row):
    keys = (
        "id",
        "title",
        "name",
        "status",
        "category",
        "tags",
        "pinned",
        "priority",
        "project_id",
        "scheduled_date",
        "planning_window",
        "window_start",
        "scheduled_period",
        "planned_start_at",
        "planned_end_at",
        "due_date",
        "due_at",
        "due_period",
        "is_past_plan",
        "estimated_minutes",
        "resource_ids",
        "type",
        "url",
        "current_position",
        "position_unit",
        "progress_status",
        "updated_at",
    )
    return {k: row[k] for k in keys if k in row}


def daily_plan(db, day, available):
    rows = [
        t for t in services.list_tasks(db) if t["status"] not in ("done", "cancelled")
    ]
    booked = [t for t in rows if t.get("scheduled_date") == day]
    free = max(0, available - sum(t.get("estimated_minutes") or 0 for t in booked))
    candidates = [
        t for t in rows if (t.get("scheduled_date") or "") < day and (t.get("window_start") or "") <= day
    ]
    candidates.sort(
        key=lambda t: (
            t.get("due_date") or (t.get("due_at") or "9999")[:10],
            {"high": 0, "medium": 1, "low": 2}.get(t.get("priority"), 3),
            t["id"],
        )
    )
    proposed = []
    for t in candidates:
        if free <= 0:
            break
        estimate = t.get("estimated_minutes")
        minutes = min(free, estimate or 30)
        proposed.append(
            {
                "id": t["id"],
                "title": t["title"],
                "minutes": minutes,
                "estimated": estimate is None,
            }
        )
        free -= minutes
    return {
        "saved": False,
        "date": day,
        "available_minutes": available,
        "already_scheduled": [brief(t) for t in booked[:50]],
        "proposed": proposed[:50],
        "unknown_booked_durations": sum(not t.get("estimated_minutes") for t in booked),
    }


def execute(db, name, raw, conversation_id, *, allow_conflict=False, today=None, confirmed=False):
    if name in workspace_tools.DEFINITIONS:
        return workspace_tools.execute(db,name,raw,conversation_id,confirmed=confirmed)
    if name not in DEFINITIONS:
        raise HTTPException(422, "未知工具。")
    data = DEFINITIONS[name][0].model_validate(raw).model_dump(exclude_unset=True)
    today = today or local_day(db)
    data = normalize_dates(data, today)
    meta = {"source": "ai", "conversation_id": conversation_id}

    if name == "search_tasks":
        return [brief(r) for r in services.list_tasks(db, **data)[:50]]
    if name == "list_tasks_by_date":
        day = date.fromisoformat(data["date"])
        plans = services.list_tasks(db, scheduled_date=day) + services.previous_day_plans(db, day, day)
        return [brief(r) for r in plans[:50]]
    if name == "list_tags":
        return list_tags(db)
    if name == "create_tag":
        return create_tag(db, TagInput.model_validate(data))
    if name == "list_projects":
        return [brief(r) for r in services.list_projects(db)[:50]]
    if name == "search_resources":
        return [brief(r) for r in services.list_resources(db, **data)[:50]]
    if name == "generate_daily_plan":
        return daily_plan(db, data["date"], data["available_minutes"])
    if name == "create_project":
        return brief(services.create_project(db, data, **meta))
    if name == "create_resource":
        existing = next(
            (r for r in services.list_resources(db) if r.get("url") == data["url"]),
            None,
        )
        resource = existing or services.create_resource(db, data, **meta)
        return brief(resource)
    if name in ("create_task", "save_and_schedule_resource"):
        raise HTTPException(409, "请先在聊天卡片确认创建任务。")
    target = identify(db, data, today)
    if name == "get_task":
        return brief(target)
    if name == "delete_task":
        services.delete_task(db, target["id"], **meta)
        return {"id": target["id"], "title": target["title"], "deleted": True}
    if name == "complete_task":
        changes = {"status": "done"}
    elif name == "update_task":
        changes = normalize_dates(data["changes"], today)
    elif name == "schedule_task":
        changes = {
            k: v for k, v in data.items() if k not in ("query","on_date")
        }
        if not changes:
            from app.i18n import DomainError
            raise DomainError(422,"task.schedule_empty")
    else:
        changes = {
            "resource_ids": list(
                dict.fromkeys([*target["resource_ids"], data["resource_id"]])
            )
        }
    if allow_conflict:
        changes["allow_due_conflict"] = True
    return brief(services.update_task(db, target["id"], changes, **meta))
