"""Persist editable proposals without creating a task or its associated resource."""

from copy import deepcopy
from typing import Literal

from fastapi import HTTPException
from pydantic import Field

from app import services
from app.models import Project
from app.records import active, lock_for_write
from app.schemas import ResourceInput, TaskInput
from app.time_rules import apply_time_rules, merge_schedule

from .locale import preference, translate
from .models import ChatTurn, Message, PendingAction
from .tools import Params, brief

CREATES = {"create_task", "save_and_schedule_resource"}


class EditableTask(Params):
    title: str | None = Field(None, min_length=1, max_length=500)
    description: str | None = Field(None, max_length=30000)
    category: str | None = Field(None, max_length=300)
    project_id: int | None = Field(None, gt=0)
    priority: Literal["low", "medium", "high"] | None = None
    scheduled_date: str | None = None
    planning_window: Literal["week","month"] | None = None
    window_start: str | None = None
    scheduled_period: Literal["morning", "afternoon", "evening"] | None = None
    planned_start_at: str | None = None
    planned_end_at: str | None = None
    estimated_minutes: int | None = Field(None, gt=0, le=525600)
    due_date: str | None = None
    due_at: str | None = None


class DraftEdit(Params):
    index: int = Field(ge=0)
    task: EditableTask


class DraftPatch(Params):
    version: int = Field(ge=1)
    drafts: list[DraftEdit] = Field(min_length=1, max_length=20)


def is_draft(row):
    return any(a["name"] in CREATES for a in row.actions)


def task_values(action):
    if "draft_task" in action:
        return action["draft_task"]
    args = action["args"]
    if action["name"] == "create_task":
        return {k: v for k, v in args.items() if k in EditableTask.model_fields}
    values = {k: v for k, v in args.items() if k in EditableTask.model_fields}
    values["title"] = args["task_title"]
    if "task_description" in args:
        values["description"] = args["task_description"]
    if "task_project_id" in args:
        values["project_id"] = args["task_project_id"]
    return values


def resource_values(action):
    return {k: v for k, v in action["args"].items() if k in ResourceInput.model_fields}


def validate(db, action):
    candidate = TaskInput.model_validate(task_values(action))
    if candidate.project_id:
        active(db, Project, candidate.project_id)
    for resource_id in action["args"].get("resource_ids") or []:
        services.get_resource(db, resource_id)
    if action["name"] == "save_and_schedule_resource":
        resource = ResourceInput.model_validate(resource_values(action))
        for project_id in resource.project_ids:
            active(db, Project, project_id)
    conflict = False
    try:
        apply_time_rules(candidate, services.get_settings(db)["timezone"])
    except HTTPException as exc:
        if exc.status_code != 409:
            raise
        conflict = True
    action["draft_task"] = candidate.model_dump(
        mode="json", include=set(EditableTask.model_fields)
    )
    action["conflict"] = conflict


def summary(actions, lang):
    titles = "、".join(
        "「" + a["draft_task"]["title"] + "」" for a in actions if a["name"] in CREATES
    )
    return f"{translate('任务草稿', lang)} {titles}"


def event(row):
    cards = []
    results = (row.result or {}).get("changes", [])
    for index, action in enumerate(row.actions):
        if action["name"] not in CREATES:
            continue
        item = {"index": index, "task": action["draft_task"]}
        if action["name"] == "save_and_schedule_resource":
            item["resource"] = {k: action["args"][k] for k in ("title", "type", "url")}
        if row.status == "approved" and len(results) > index:
            receipt = results[index]
            item["task_id"] = receipt.get("task", receipt)["id"]
        cards.append(item)
    return {
        "type": "task_draft",
        "id": row.id,
        "version": row.version,
        "status": row.status,
        "drafts": cards,
        "summary": row.summary,
        "conflict": any(a.get("conflict") for a in row.actions),
    }


def new(db, turn, actions):
    for action in actions:
        validate(db, action)
    row = PendingAction(
        turn_id=turn.id,
        conversation_id=turn.conversation_id,
        actions=actions,
        summary=summary(actions, preference(db)),
    )
    db.add(row)
    db.flush()
    return event(row)


def get(db, pending_id):
    row = db.get(PendingAction, pending_id)
    if not row:
        raise HTTPException(404, "草稿或确认请求不存在。")
    # Pending proposals from before editable cards retain their original target and user intent.
    if is_draft(row) and any(
        "draft_task" not in a for a in row.actions if a["name"] in CREATES
    ):
        lock_for_write(db)
        db.refresh(row)
        actions = deepcopy(row.actions)
        if all("draft_task" in a for a in actions if a["name"] in CREATES):
            return row
        for action in actions:
            if action["name"] in CREATES:
                validate(db, action)
        other = [a for a in actions if a["name"] not in CREATES]
        if other and row.status=="pending":
            # An approval button for task creation cannot authorize unrelated mutations.
            from .agent import action_summary

            separate = PendingAction(turn_id=row.turn_id,conversation_id=row.conversation_id,
                                     actions=other,summary=action_summary(other,preference(db)))
            db.add(separate)
            db.flush()
            msg = db.get(Message,db.get(ChatTurn,row.turn_id).message_id)
            msg.tools = [*msg.tools,{"type":"confirmation","id":separate.id,"summary":separate.summary}]
            actions = [a for a in actions if a["name"] in CREATES]
        row.actions = actions
        row.summary = summary(actions, preference(db))
        sync_message(db, row)
    return row


def sync_message(db, row):
    turn = db.get(ChatTurn, row.turn_id)
    msg = db.get(Message, turn.message_id)
    replacement = event(row)
    msg.tools = [
        replacement
        if e.get("id") == row.id and e.get("type") in ("confirmation", "task_draft")
        else e
        for e in msg.tools
    ]
    return replacement


def same_version(row, version):
    if version != row.version:
        raise HTTPException(409, "草稿版本已变化，请刷新卡片后继续。")


def edit(db, pending_id, changes):
    lock_for_write(db)
    row = get(db, pending_id)
    if not is_draft(row) or row.status != "pending":
        raise HTTPException(409, "只有待确认的任务草稿可以编辑。")
    same_version(row, changes.version)
    actions = deepcopy(row.actions)
    seen = set()
    for edit in changes.drafts:
        if (
            edit.index in seen
            or edit.index >= len(actions)
            or actions[edit.index]["name"] not in CREATES
        ):
            raise HTTPException(422, "草稿索引无效或重复。")
        seen.add(edit.index)
        action = actions[edit.index]
        delta = edit.task.model_dump(exclude_unset=True)
        if not delta:
            raise HTTPException(422, "请至少修改一项任务属性。")
        current = action["draft_task"]
        if "scheduled_date" in delta and delta["scheduled_date"] != current.get(
            "scheduled_date"
        ):
            for key in ("planned_start_at", "planned_end_at"):
                delta.setdefault(key, None)
            if not delta["scheduled_date"]:
                delta.setdefault("scheduled_period", None)
        if delta.get("due_date") and "due_at" not in delta:
            delta["due_at"] = None
        if delta.get("due_at") and "due_date" not in delta:
            delta["due_date"] = None
        action["draft_task"] = merge_schedule(current,delta)
        validate(db, action)
    row.actions = actions
    row.summary = summary(actions, preference(db))
    row.version += 1
    snapshot = sync_message(db, row)
    db.flush()
    return snapshot


def commit_approved(db, action, conversation_id, allow_conflict):
    # Only called by the local confirmation route. Models cannot set this override.
    validate(db, action)
    meta = {"source": "ai", "conversation_id": conversation_id}
    values = {
        **action["draft_task"],
        "resource_ids": action["args"].get("resource_ids", []),
        "allow_due_conflict": allow_conflict,
    }
    if action["name"] == "create_task":
        return brief(services.create_task(db, values, **meta))
    resource_values_valid = ResourceInput.model_validate(
        resource_values(action)
    ).model_dump(mode="json")
    url = resource_values_valid["url"]
    resource = next(
        (r for r in services.list_resources(db) if r.get("url") == url), None
    )
    resource = resource or services.create_resource(db, resource_values_valid, **meta)
    values["resource_ids"] = [resource["id"]]
    return {
        "resource": brief(resource),
        "task": brief(services.create_task(db, values, **meta)),
    }
