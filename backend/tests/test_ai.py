"""AI domain integration uses a scripted provider and real SQLite transactions."""

import json
from datetime import date
from uuid import uuid4

import httpx
import pytest
from app import services
from app.ai import agent, providers
from app.ai.adapters import Adapter, Call, ProviderError, Round
from app.ai.models import AIProvider, ChatTurn, Message, PendingAction
from app.ai.router import router
from app.ai.tools import functions, resolve_day
from app.db import Base, get_db
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker


@pytest.fixture
def api(tmp_path, monkeypatch):
    monkeypatch.setenv("DAYWEAVE_DATA_DIR", str(tmp_path))
    engine = create_engine(
        "sqlite:///" + (tmp_path / "test.sqlite").as_posix(),
        connect_args={"check_same_thread": False},
    )
    Base.metadata.create_all(engine)
    sessions = sessionmaker(bind=engine, expire_on_commit=False)
    app = FastAPI()
    app.include_router(router)

    def db_override():
        with sessions() as db:
            yield db
            db.commit()

    app.dependency_overrides[get_db] = db_override
    client = TestClient(app)
    calls = []

    class Fake(Adapter):
        def list_models(self):
            return [{"id": "deepseek-flash", "name": "DeepSeek Flash"}]

        def stream(self, instructions, history, functions, model, reasoning, result):
            step = calls.pop(0)
            if isinstance(step, str):
                result.text = step
                yield step
            else:
                result.calls = [
                    Call(str(i), n, json.dumps(a)) for i, (n, a) in enumerate(step)
                ]
                result.wire.append({"role": "assistant", "content": "query"})

    adapter = Fake("deepseek", "https://api.deepseek.com", "unused")
    monkeypatch.setattr(agent, "adapter_for", lambda db, row: adapter)
    monkeypatch.setattr(providers, "adapter_for", lambda db, row: adapter)
    assert client.patch(
        "/api/ai/providers/deepseek", json={"api_key": "secret-123"}
    ).is_success
    assert (
        client.post("/api/ai/providers/deepseek/test").json()["status"] == "connected"
    )
    yield client, sessions, calls
    client.close()
    engine.dispose()


def request(client, text, **more):
    data = {"request_id": str(uuid4()), "content": text, "provider": "deepseek", **more}
    response = client.post("/api/ai/chat", json=data)
    assert response.status_code == 200, response.text
    return data, [
        json.loads(line[6:])
        for line in response.text.splitlines()
        if line.startswith("data: ")
    ]


def draft_receipt(client, events):
    card = next(e for e in events if e["type"] == "task_draft")
    result = client.post(
        f"/api/ai/confirmations/{card['id']}",
        json={
            "approve": True,
            "version": card["version"],
            "allow_due_conflict": card["conflict"],
        },
    )
    assert result.is_success, result.text
    return result.json()


def test_create_precision_and_replay(api):
    client, sessions, steps = api
    steps.append(
        [
            (
                "create_task",
                {
                    "title": "研究 ROS2 tracing",
                    "scheduled_date": "明天",
                    "scheduled_period": "afternoon",
                    "planned_start_at": "2026-01-01T15:00:00+08:00",
                    "due_date": "周五",
                    "estimated_minutes": 60,
                },
            )
        ]
    )
    # Choose a specific weekday pair independent from the machine's clock for this assertion.
    _, events = request(client, "明天下午花一个小时研究 ROS2 tracing，周五前完成")
    with sessions() as db:
        assert not services.list_tasks(db)
    draft_receipt(client, events)
    with sessions() as db:
        (task,) = services.list_tasks(db)
        assert (
            task["scheduled_period"] == "afternoon" and task["planned_start_at"] is None
        )
        assert (
            task["estimated_minutes"] == 60
            and task["due_at"] is None
            and task["due_date"]
        )
    steps.append([("create_task", {"title": "研究 FastDDS", "scheduled_date": "明天"})])
    data, events = request(client, "有空研究一下 FastDDS")
    assert events[-1]["type"] == "done"
    replay = client.post("/api/ai/chat", json=data)
    assert replay.is_success
    draft_receipt(client, events)
    assert (
        client.post("/api/ai/chat", json={**data, "content": "other text"}).status_code
        == 409
    )
    with sessions() as db:
        assert len(services.list_tasks(db)) == 2
        assert [r["title"] for r in services.list_tasks(db, view="inbox")] == [
            "研究 FastDDS"
        ]
        assert [x.role for x in db.scalars(select(Message).order_by(Message.id))] == [
            "user",
            "assistant",
            "user",
            "assistant",
        ]


def test_tools_roundtrip_resource_and_real_query(api):
    client, sessions, steps = api
    steps.append(
        [
            (
                "save_and_schedule_resource",
                {
                    "url": "https://www.youtube.com/watch?v=abc",
                    "type": "video",
                    "title": "演讲",
                    "task_title": "观看演讲",
                    "scheduled_date": "明天",
                },
            )
        ]
    )
    _, saved = request(client, "这个视频明天看 https://www.youtube.com/watch?v=abc")
    with sessions() as db:
        assert not services.list_resources(db) and not services.list_tasks(db)
    result = draft_receipt(client, saved)["result"]["changes"][0]
    assert result["task"]["resource_ids"] == [result["resource"]["id"]]
    steps.extend([[("list_tasks_by_date", {"date": "明天"})], "明天安排了观看演讲。"])
    _, ev = request(client, "明天有什么要做？")
    assert (
        next(e for e in ev if e["type"] == "tool")["result"][0]["title"] == "观看演讲"
    )
    steps.append([("complete_task", {"query": "观看演讲"})])
    _, ev = request(client, "把观看演讲标记完成")
    assert next(e for e in ev if e["type"] == "tool")["result"]["status"] == "done"
    with sessions() as db:
        assert services.get_task(db, result["task"]["id"])["status"] == "done"
        assert len(services.list_resources(db)) == 1


def test_clarifies_target_and_unparsed_date(api):
    client, sessions, steps = api
    with sessions.begin() as db:
        for label in ("接口联调 A", "接口联调 B"):
            services.create_task(db, {"title": label})
    steps.append([("complete_task", {"query": "接口联调"})])
    _, ev = request(client, "把接口联调标记完成")
    assert "多个匹配" in next(e["message"] for e in ev if e["type"] == "error")
    steps.append(
        [("schedule_task", {"query": "接口联调 A", "scheduled_date": "某个好日子"})]
    )
    _, ev = request(client, "把接口联调 A 改到某个好日子")
    assert "明确日期" in next(e["message"] for e in ev if e["type"] == "error")
    with sessions() as db:
        assert all(
            t["status"] == "todo" and t["scheduled_date"] is None
            for t in services.list_tasks(db)
        )


def test_bulk_and_conflicts_review_before_write(api):
    client, sessions, steps = api
    with sessions.begin() as db:
        for name in ["采购", "整理"]:
            services.create_task(db, {"title": name, "due_date": "2027-01-01"})
    steps.append(
        [("complete_task", {"query": "采购"}), ("complete_task", {"query": "整理"})]
    )
    _, ev = request(client, "完成采购和整理")
    approval = next(e["id"] for e in ev if e["type"] == "confirmation")
    with sessions() as db:
        assert all(t["status"] == "todo" for t in services.list_tasks(db))
    url = f"/api/ai/confirmations/{approval}"
    assert (
        client.post(url, json={"approve": True}).json()
        == client.post(url, json={"approve": True}).json()
    )
    with sessions() as db:
        assert all(t["status"] == "done" for t in services.list_tasks(db))
    steps.append([("schedule_task", {"query": "采购", "scheduled_date": "2027-01-20"})])
    _, ev = request(client, "把采购安排在 2027-01-20")
    p = next(e for e in ev if e["type"] == "confirmation")
    assert "截止" in p["summary"]
    assert client.post(
        f"/api/ai/confirmations/{p['id']}", json={"approve": True}
    ).is_success
    with sessions() as db:
        t = services.list_tasks(db, q="采购")[0]
        assert t["due_date"] == "2027-01-01" and t["scheduled_date"] == "2027-01-20"


def test_delete_stale_and_recovery(api):
    client, sessions, steps = api
    with sessions.begin() as db:
        t = services.create_task(db, {"title": "草稿"})
    steps.append([("delete_task", {"query": "草稿"})])
    _, ev = request(client, "删除草稿")
    p = next(e for e in ev if e["type"] == "confirmation")
    with sessions.begin() as db:
        services.update_task(db, t["id"], {"title": "保留新版本"})
    res = client.post(f"/api/ai/confirmations/{p['id']}", json={"approve": True})
    assert res.status_code == 409
    assert (
        client.post(f"/api/ai/confirmations/{p['id']}", json={"approve": False}).json()[
            "status"
        ]
        == "cancelled"
    )
    with sessions() as db:
        assert services.get_task(db, t["id"])["title"] == "保留新版本"


def test_credentials_are_encrypted_and_never_returned(api):
    client, sessions, _ = api
    state = client.get("/api/ai/providers")
    assert "secret-123" not in state.text
    assert (
        next(p for p in state.json() if p["id"] == "chatgpt")["status"]
        == "unconfigured"
    )
    with sessions() as db:
        assert "secret-123" not in db.get(AIProvider, "deepseek").secret
    assert (
        client.patch(
            "/api/ai/providers/deepseek", json={"base_url": "https://example.com"}
        ).status_code
        == 422
    )
    assert (
        client.patch(
            "/api/ai/providers/compatible", json={"base_url": "http://example.com/v1"}
        ).status_code
        == 422
    )
    assert client.patch(
        "/api/ai/providers/compatible",
        json={"base_url": "https://example.com/v1", "api_key": "abc"},
    ).json()["has_key"]
    assert not client.patch(
        "/api/ai/providers/compatible", json={"base_url": "https://example.net/v1"}
    ).json()["has_key"]


def test_date_edges():
    assert resolve_day("明天", date(2026, 12, 31)) == "2027-01-01"
    assert resolve_day("明天", date(2028, 2, 28)) == "2028-02-29"
    assert resolve_day("下周六", date(2026, 11, 22)) == "2026-11-28"
    assert resolve_day("来週の土曜日", date(2026, 11, 22)) == "2026-11-28"
    assert resolve_day("Next Saturday", date(2026, 11, 22)) == "2026-11-28"
    assert resolve_day("明後日", date(2026, 12, 31)) == "2027-01-02"


@pytest.mark.parametrize(
    ("lang", "prompt", "day", "expect"),
    [
        (
            "en",
            "Create a task to inspect tracing tomorrow afternoon",
            "tomorrow",
            "Review the draft",
        ),
        ("ja", "明日の午後にトレースを確認するタスクを作成", "明日", "下書きを確認"),
    ],
)
def test_edit_persist_then_confirm_localized_draft(api, lang, prompt, day, expect):
    client, sessions, steps = api
    with sessions.begin() as db:
        services.update_settings(db, {"language": lang})
        project = services.create_project(db, {"name": "Research"})
    steps.append(
        [
            (
                "create_task",
                {
                    "title": "Tracing",
                    "scheduled_date": day,
                    "scheduled_period": "afternoon",
                },
            )
        ]
    )
    _, events = request(client, prompt)
    assert expect in next(e["text"] for e in events if e["type"] == "delta")
    card = next(e for e in events if e["type"] == "task_draft")
    assert card["drafts"][0]["task"]["scheduled_date"] and card["version"] == 1
    url = f"/api/ai/confirmations/{card['id']}"
    cid = next(e["id"] for e in events if e["type"] == "conversation")
    assert client.post(url, json={"approve": True}).status_code == 409
    invalid = {
        "version": 1,
        "drafts": [{"index": 0, "task": {"source": "manual", "id": 5}}],
    }
    assert client.patch(url + "/draft", json=invalid).status_code == 422
    fields = {
        "title": "Tracing review",
        "priority": "high",
        "project_id": project["id"],
        "category": "Analysis",
        "description": "Notes",
        "scheduled_date": "2027-01-11",
        "scheduled_period": "morning",
        "estimated_minutes": 90,
        "due_date": "2027-01-10",
    }
    patch = {"version": 1, "drafts": [{"index": 0, "task": fields}]}
    updated = client.patch(url + "/draft", json=patch).json()
    assert updated["version"] == 2 and updated["conflict"]
    assert client.patch(url + "/draft", json=patch).status_code == 409
    m = client.get(f"/api/ai/conversations/{cid}").json()["messages"][-1]
    assert m["tools"][0] == updated
    with sessions() as db:
        assert not services.list_tasks(db)
    assert client.post(url, json={"approve": True, "version": 2}).status_code == 409
    save = client.post(
        url, json={"approve": True, "version": 2, "allow_due_conflict": True}
    )
    assert save.is_success, save.text
    assert client.post(url, json={"approve": True, "version": 2}).json() == save.json()
    assert save.json()["event"]["status"] == "approved"
    with sessions() as db:
        (row,) = services.list_tasks(db)
        assert all(row[k] == v for k, v in fields.items())
        assert row["id"] == save.json()["event"]["drafts"][0]["task_id"]
        assert row["planned_start_at"] is None and row["due_at"] is None
    assert client.patch(url + "/draft", json=patch).status_code == 409


def test_cancel_multiple_task_drafts_never_creates_tasks(api):
    client, sessions, steps = api
    steps.append([("create_task", {"title": "One"}), ("create_task", {"title": "Two"})])
    _, events = request(client, "创建 One 和 Two 两个任务")
    card = next(e for e in events if e["type"] == "task_draft")
    assert len(card["drafts"]) == 2
    url = f"/api/ai/confirmations/{card['id']}"
    cancel = client.post(url, json={"approve": False, "version": 1})
    assert cancel.json()["event"]["status"] == "cancelled"
    assert (
        client.post(url, json={"approve": True, "version": 1}).json() == cancel.json()
    )
    with sessions() as db:
        assert not services.list_tasks(db)


def test_english_workspace_question_queries_actual_day(api):
    client,sessions,steps=api
    from app.ai.tools import local_day
    from datetime import timedelta
    with sessions.begin() as db:
        services.update_settings(db,{"language":"en"})
        services.create_task(db,{"title":"A real appointment","scheduled_date":local_day(db)+timedelta(days=1)})
    steps.extend(["OK","Tomorrow you have one appointment."])
    _,events=request(client,"What is on my schedule tomorrow?")
    assert next(e["result"] for e in events if e["type"]=="tool")[0]["title"]=="A real appointment"


def test_japanese_draft_preserves_duration_and_nullable_provider_fields(api):
    client,sessions,steps=api
    steps.append([("create_task",{"title":"設計","description":None,"priority":None,"resource_ids":None,
        "estimated_minutes":60,"scheduled_date":"あさって","scheduled_period":"afternoon",
        "planned_start_at":"2027-01-01T13:00:00+09:00"})])
    _,events=request(client,"あさっての午後、設計に一時間を使うタスクを作成")
    card=next(e for e in events if e["type"]=="task_draft")
    task=card["drafts"][0]["task"]
    assert task["scheduled_date"] and task["planned_start_at"] is None and task["estimated_minutes"]==60
    assert task["priority"]=="medium" and task["description"]==""
    assert draft_receipt(client,events)["event"]["status"]=="approved"


@pytest.mark.parametrize(("text","window"),[
    ("下周处理文档","week"),("Plan to read the report this month","month"),("今週に資料整理を予定","week")])
def test_whole_period_uses_floating_draft_and_no_invented_day(api,text,window):
    client,sessions,steps=api
    steps.append([("create_task",{"title":"Doc","scheduled_date":"tomorrow"})])
    _,events=request(client,text)
    task=next(e["drafts"][0]["task"] for e in events if e["type"]=="task_draft")
    assert task["planning_window"]==window and task["scheduled_date"] is None
    start=date.fromisoformat(task["window_start"])
    assert start.weekday()==0 if window=="week" else start.day==1
    assert draft_receipt(client,events)["result"]["changes"][0]["window_start"]==task["window_start"]


def test_old_mixed_creation_confirmation_cannot_delete_another_task(api):
    client,sessions,steps=api
    steps.append([("create_task",{"title":"New"})])
    _,events=request(client,"创建 New")
    card=next(e for e in events if e["type"]=="task_draft")
    conversation=next(e["id"] for e in events if e["type"]=="conversation")
    with sessions.begin() as db:
        other=services.create_task(db,{"title":"Existing"})
        row=db.get(PendingAction,card["id"])
        row.actions=[{"name":"create_task","args":{"title":"New"}},{"name":"delete_task","args":{"query":"Existing"},
                    "target_id":other["id"],"version":other["updated_at"],"label":"Existing"}]
        turn=db.get(ChatTurn,row.turn_id)
        db.get(Message,turn.message_id).tools=[{"type":"confirmation","id":row.id,"summary":"Legacy review"}]
    history=client.get(f"/api/ai/conversations/{conversation}").json()["messages"][-1]["tools"]
    assert {e["type"] for e in history}=={"task_draft","confirmation"}
    assert draft_receipt(client,history)["event"]["status"]=="approved"
    with sessions() as db:
        assert {r["title"] for r in services.list_tasks(db)}=={"New","Existing"}


def test_abandoned_turn_resumes_once_and_fences_old_worker(api):
    client, sessions, steps = api
    from app.ai.router import ChatRequest

    req = ChatRequest(
        content="有空研究 SQL", provider="deepseek", request_id=str(uuid4())
    )
    with sessions() as db:
        turn, replay = agent.reserve(db, req, services.get_settings(db))
        assert not replay
        old = turn.lease
        turn.lease_until = 0
        db.commit()
    steps.append([("create_task", {"title": "研究 SQL"})])
    response = client.post("/api/ai/chat", json=req.model_dump())
    assert response.is_success
    with sessions() as db:
        turn = db.get(ChatTurn, req.request_id)
        assert turn.state == "done" and turn.lease != old
        db.info["turn_lease"] = old
        with pytest.raises(agent.StaleWorker):
            agent.check_lease(db, turn)
        assert not services.list_tasks(db)


def test_plan_has_allocations_but_no_writes(api):
    client, sessions, steps = api
    with sessions.begin() as db:
        services.create_task(
            db,
            {"title": "有截止要求", "due_date": "2027-01-01", "estimated_minutes": 40},
        )
        services.create_task(
            db,
            {
                "title": "已有计划",
                "scheduled_date": "2027-01-01",
                "estimated_minutes": 20,
            },
        )
    steps.extend(
        [
            [("generate_daily_plan", {"date": "2027-01-01", "available_minutes": 45})],
            "建议先处理到期任务。",
        ]
    )
    _, events = request(client, "我在 2027-01-01 有 45 分钟，帮我规划")
    plan = next(e["result"] for e in events if e["type"] == "tool")
    assert plan["saved"] is False and plan["proposed"][0]["minutes"] == 25
    with sessions() as db:
        assert len(services.list_tasks(db, scheduled_date="2027-01-01")) == 1


def test_wire_protocol_and_no_incomplete_write(monkeypatch):
    captured = []

    def transport(req):
        body = json.loads(req.content)
        captured.append(body)
        events = [
            {"choices": [{"index": 0, "delta": {"reasoning_content": "private"}}]},
            {
                "choices": [
                    {
                        "index": 0,
                        "delta": {
                            "tool_calls": [
                                {
                                    "index": 0,
                                    "id": "call",
                                    "function": {
                                        "name": "create_task",
                                        "arguments": "{",
                                    },
                                }
                            ]
                        },
                    }
                ]
            },
            {
                "choices": [
                    {
                        "index": 0,
                        "delta": {
                            "tool_calls": [{"index": 0, "function": {"arguments": "}"}}]
                        },
                        "finish_reason": "tool_calls",
                    }
                ]
            },
        ]
        return httpx.Response(
            200, text="".join("data: " + json.dumps(e) + "\n\n" for e in events)
        )

    adapter = Adapter("deepseek", "https://example.test", "never-used")
    monkeypatch.setattr(
        adapter,
        "client",
        lambda: httpx.Client(transport=httpx.MockTransport(transport)),
    )
    out = Round()
    assert (
        list(
            adapter.stream(
                "instructions", [], functions(), "deepseek-flash", "low", out
            )
        )
        == []
    )
    assert (
        out.calls[0].arguments == "{}" and out.wire[0]["reasoning_content"] == "private"
    )
    assert (
        captured[0]["reasoning_effort"] == "low"
        and captured[0]["thinking"]["type"] == "enabled"
    )
    adapter = Adapter("chatgpt", "https://api.openai.com/v1", "not-a-real-token")

    def incomplete(path, body):
        assert (
            body["store"] is False
            and body["stream"]
            and body["tools"][0]["type"] == "namespace"
        )
        yield {"type": "response.output_text.delta", "delta": "partial"}

    monkeypatch.setattr(adapter, "_events", incomplete)
    with pytest.raises(ProviderError):
        list(
            adapter.stream(
                "instructions", [], functions(), "account-model", "auto", Round()
            )
        )
