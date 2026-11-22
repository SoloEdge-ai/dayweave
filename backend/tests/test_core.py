from datetime import date, datetime, timezone

import pytest
from fastapi import HTTPException
from pydantic import ValidationError
from sqlalchemy import create_engine, event
from sqlalchemy.orm import Session

from app import services
from app.db import Base
from app.time_rules import local_today, week_bounds


@pytest.fixture
def db(tmp_path):
    engine = create_engine("sqlite:///" + (tmp_path / "workspace.db").as_posix())
    event.listen(engine, "connect", lambda connection, _: connection.execute("PRAGMA foreign_keys=ON"))
    Base.metadata.create_all(engine)
    with Session(engine, expire_on_commit=False) as session:
        yield session
    engine.dispose()


def test_task_lifecycle_and_audit(db):
    created = services.create_task(db, {"title": "联调"}, source="ai", conversation_id=5)
    tid = created["id"]
    assert created["due_at"] is None and created["scheduled_date"] is None
    assert [t["id"] for t in services.list_tasks(db, view="inbox")] == [tid]
    changed = services.update_task(db, tid, {"scheduled_date": "2031-04-30", "due_date": "2031-05-02",
                                            "estimated_minutes": 60, "scheduled_period": "afternoon"})
    assert changed["planned_start_at"] is None
    moved = services.update_task(db, tid, {"scheduled_date": "2031-05-01"})
    assert moved["due_date"] == "2031-05-02"
    done = services.update_task(db, tid, {"status": "done"})
    assert done["completed_at"] and services.list_tasks(db, view="completed") == [done]
    services.delete_task(db, tid)
    assert services.list_tasks(db) == []
    logs = services.list_changes(db)
    assert logs[-1]["source"] == "ai" and logs[-1]["conversation_id"] == 5
    assert logs[0]["before"]["status"] == "done" and logs[0]["after"] is None
    with pytest.raises(HTTPException, match="后续变更"):
        services.undo(db, logs[1]["id"])
    services.undo(db, logs[0]["id"])
    assert services.get_task(db, tid)["completed_at"] == done["completed_at"]
    services.undo(db, logs[1]["id"])
    assert services.get_task(db, tid)["completed_at"] is None


def test_filters_and_week_rollover(db, monkeypatch):
    monkeypatch.setattr(services, "local_today", lambda zone: date(2026, 12, 31))
    p = services.create_project(db, {"name": "学习"})
    for i, day in enumerate(["2026-12-27", "2026-12-28", "2026-12-31", "2027-01-01", "2027-01-03", "2027-01-04"]):
        services.create_task(db, {"title": f"ROS2 {i}", "category": "学习", "project_id": p["id"],
                                  "scheduled_date": day, "priority": "high", "due_date": "2027-02-01"})
    list_days = lambda view: sorted(x["scheduled_date"] for x in services.list_tasks(db, view=view))
    assert list_days("today") == ["2026-12-31"]
    assert list_days("tomorrow") == ["2027-01-01"]
    assert list_days("week") == ["2026-12-28", "2026-12-31", "2027-01-01", "2027-01-03"]
    with pytest.raises(ValueError):
        services.update_settings(db, {"week_start": 6})
    assert list_days("next_week") == ["2027-01-04"]
    rows = services.list_tasks(db, q="ROS2", priority="high", category="学习", status="todo",
                               scheduled_date="2027-01-01", due_date="2027-02-01", project_id=p["id"])
    assert [t["title"] for t in rows] == ["ROS2 3"]
    assert len(services.project_detail(db, p["id"])["tasks"]) == 6


def test_timezone_month_and_year():
    instant = datetime(2026, 12, 31, 20, tzinfo=timezone.utc)
    assert local_today("Asia/Hong_Kong", instant) == date(2027, 1, 1)
    assert local_today("America/Los_Angeles", instant) == date(2026, 12, 31)
    assert week_bounds(date(2028, 3, 1)) == (date(2028, 2, 28), date(2028, 3, 5))


def test_window_overlap_and_sunday_to_monday_rollover(db,monkeypatch):
    for title,fields in [
        ("unscheduled",{}),("Sunday",{"scheduled_date":"2027-01-03"}),
        ("December week",{"planning_window":"week","window_start":"2026-12-28"}),
        ("January week",{"planning_window":"week","window_start":"2027-01-04"}),
        ("January month",{"planning_window":"month","window_start":"2027-01-01"}),
        ("December month",{"planning_window":"month","window_start":"2026-12-01"}),
    ]:
        services.create_task(db,{"title":title,**fields})
    def titles(view):
        return {t["title"] for t in services.list_tasks(db,view=view)}
    monkeypatch.setattr(services,"local_today",lambda zone:date(2027,1,3))
    assert titles("inbox")=={"unscheduled"}
    assert titles("today")=={"Sunday"}
    assert titles("week")=={"December week","Sunday"}
    assert titles("next_week")=={"January week"}
    assert titles("month")=={"Sunday","December week","January week","January month"}
    monkeypatch.setattr(services,"local_today",lambda zone:date(2027,1,4))
    assert titles("week")=={"January week"}
    assert titles("next_week")==set()


def test_exact_deadline_and_slot_precision(db):
    task = services.create_task(db, {"title": "测试", "planned_start_at": "2030-12-31T23:00:00+00:00",
                                     "planned_end_at": "2031-01-01T01:00:00+00:00", "due_date": "2031-01-01"})
    assert task["scheduled_date"] == "2031-01-01" and task["due_at"] is None
    with pytest.raises(HTTPException) as error:
        services.update_task(db, task["id"], {"due_at": "2031-01-01T08:00:00+08:00"})
    assert error.value.status_code == 409
    confirmed = services.update_task(db, task["id"], {"due_at": "2031-01-01T08:00:00+08:00", "allow_due_conflict": True})
    assert confirmed["due_date"] is None and confirmed["due_at"].startswith("2031-01-01T00:00:00")
    assert services.list_tasks(db, due_date="2031-01-01")[0]["id"] == task["id"]
    services.update_settings(db, {"timezone": "America/Los_Angeles"})
    assert services.list_tasks(db, due_date="2030-12-31")[0]["id"] == task["id"]
    assert services.list_tasks(db, due_date="2031-01-01") == []
    assert services.update_task(db, task["id"], {"category": "学习"})["scheduled_date"] == "2030-12-31"
    services.update_settings(db, {"timezone": "Asia/Hong_Kong"})
    moved = services.update_task(db, task["id"], {"scheduled_date": None})
    assert moved["planned_start_at"] is None and moved["planned_end_at"] is None
    with pytest.raises(ValidationError):
        services.update_task(db, task["id"], {"due_at": "2031-01-01T12:00:00"})


def test_resource_links_progress_and_delete_dependencies(db):
    p = services.create_project(db, {"name": "ROS"})
    data = {"type": "video", "title": "Tracing", "url": "https://www.youtube.com/watch?v=123",
            "duration_seconds": 1800, "project_ids": [p["id"]]}
    video = services.create_resource(db, data)
    assert services.create_resource(db, data)["id"] == video["id"]
    first = services.create_task(db, {"title": "初看", "resource_ids": [video["id"]]})
    services.create_task(db, {"title": "复习", "resource_ids": [video["id"]]})
    assert first["resource_ids"] == [video["id"]]
    edited = services.update_resource(db, video["id"], {"current_position": 1110, "progress_status": "in_progress"})
    assert edited["position_unit"] == "seconds" and edited["current_position"] == 1110
    assert services.project_detail(db, p["id"])["resources"] == [edited]
    with pytest.raises(ValidationError):
        services.update_resource(db, video["id"], {"current_position": 1801})
    with pytest.raises(HTTPException) as error:
        services.soft_delete(db, services.Resource, video["id"])
    assert error.value.status_code == 409
    with pytest.raises(ValidationError):
        services.create_resource(db, {"title": "坏链接", "url": "javascript:alert(1)"})


def test_dashboard_separates_missed_tasks_and_deadline(db):
    day = local_today("Asia/Hong_Kong")
    video = services.create_resource(db, {"title": "演讲", "type": "video", "url": "https://example.org/v"})
    planned = services.create_task(db, {"title": "观看", "scheduled_date": day, "due_date": day,
                                      "resource_ids": [video["id"]], "pinned": True})
    old = services.create_task(db, {"title": "此前未完成", "scheduled_date": "2000-01-01", "due_date": "2000-01-01"})
    summary = services.dashboard(db)
    assert [t["id"] for t in summary["tasks"]] == [planned["id"]]
    assert summary["focus"][0]["id"] == planned["id"] and summary["due_today"][0]["id"] == planned["id"]
    assert summary["resources"][0]["task_ids"] == [planned["id"]]
    assert summary["missed"][0]["id"] == old["id"] and summary["overdue"][0]["id"] == old["id"]


def test_undo_does_not_dangle_references(db):
    p = services.create_project(db, {"name": "项目"})
    initial_log = services.list_changes(db)[0]["id"]
    services.create_task(db, {"title": "关联", "project_id": p["id"]})
    with pytest.raises(HTTPException) as error:
        services.undo(db, initial_log)
    assert error.value.status_code == 409
    assert services.list_projects(db)[0]["id"] == p["id"]
