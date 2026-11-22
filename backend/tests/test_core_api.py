"""Exercise the actual ASGI app, migrations, authentication, and file storage."""
from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker

PASSWORD = "disposable-test-password"

@pytest.fixture
def http(tmp_path, monkeypatch):
    from app import auth, db, main
    monkeypatch.setenv("DAYWEAVE_DATA_DIR", str(tmp_path))
    from app.email_codes import MailServer
    monkeypatch.setenv("DAYWEAVE_MAIL_FROM", "sender@example.org")
    monkeypatch.setenv("DAYWEAVE_SMTP_HOST", "localhost")
    monkeypatch.setenv("DAYWEAVE_SMTP_SECURITY", "starttls")
    monkeypatch.setattr(auth, "_attempts", {})
    def capture(server, recipient, purpose, code, language):
        if code is not None:
            (tmp_path / (recipient + "." + purpose)).write_text(code)
    monkeypatch.setattr(MailServer, "send", capture)
    engine = create_engine(db.sqlite_url(), connect_args={"check_same_thread": False})
    event.listen(engine, "connect", db.configure_sqlite)
    sessions = sessionmaker(engine, expire_on_commit=False)
    monkeypatch.setattr(db, "engine", engine)
    monkeypatch.setattr(main, "engine", engine)
    for module in (db, main):
        monkeypatch.setattr(module, "SessionLocal", sessions)
    config = Config(str(Path(__file__).resolve().parents[1] / "alembic.ini"))
    command.upgrade(config, "head")
    command.upgrade(config, "head")
    with sessions.begin() as db_session:
        auth.add_account(db_session, "admin", "admin@example.org", PASSWORD)
    with TestClient(main.app) as client:
        yield client, tmp_path
    engine.dispose()


def register(client, root, username, password):
    email = username.lower() + "@example.org"
    response = client.post("/api/auth/email-code", json={"email": email, "purpose": "register"})
    assert response.status_code == 202
    code = (root / (email + ".register")).read_text()
    return client.post("/api/auth/register", json={"email": email, "code": code, "username": username, "password": password})


def login(client, root):
    secret = PASSWORD
    result = client.post("/api/auth/login", json={"password": secret})
    assert result.status_code == 200
    assert "HttpOnly" in result.headers["set-cookie"]
    return secret


def test_schedule_optimistic_move_conflict_and_undo(http):
    client, root=http
    login(client,root)
    source = client.post("/api/tasks",json={"title":"Build","due_date":"2027-01-07",
        "planned_start_at":"2027-01-02T16:20:00+08:00","planned_end_at":"2027-01-02T17:20:00+08:00"}).json()
    url=f"/api/tasks/{source['id']}/schedule"
    def move(row,**fields):
        return client.patch(url,json={"expected_updated_at":row["updated_at"],**fields})
    def current():
        return client.get(f"/api/tasks/{source['id']}").json()
    bad=move(source,planning_window="week",window_start="2027-01-03")
    assert bad.status_code==422
    result=move(source,planning_window="week",window_start="2027-01-04")
    assert result.status_code==200, result.text
    receipt=result.json()
    week=receipt["task"]
    assert week["window_start"]=="2027-01-04"
    assert all(week[k] is None for k in ("scheduled_date","scheduled_period","planned_start_at","planned_end_at"))
    assert move(source,scheduled_date="2027-01-05").json()["code"]=="task.stale_schedule"
    undone=client.post(f"/api/changes/{receipt['change_id']}/undo").json()["record"]
    assert undone["planned_start_at"]==source["planned_start_at"] and undone["planning_window"] is None
    after=move(undone,scheduled_date="2027-01-06").json()["task"]
    assert after["planned_start_at"] is None and after["scheduled_date"]=="2027-01-06"
    window=move(after,planning_window="month",window_start="2027-01-01").json()["task"]
    assert window["scheduled_date"] is None and window["window_start"]=="2027-01-01"
    assert move(window,planning_window="week",window_start="2027-01-11").json()["code"]=="time.due_conflict"
    assert current()==window
    conflict=move(window,planning_window="week",window_start="2027-01-11",allow_due_conflict=True).json()["task"]
    assert conflict["due_date"]=="2027-01-07"
    exact=move(conflict,scheduled_date="2027-01-05",planned_start_at="2027-01-05T13:00:00+08:00").json()["task"]
    assert exact["window_start"] is None and exact["planning_window"] is None and exact["planned_start_at"]
    inbox=move(exact,scheduled_date=None).json()["task"]
    assert all(inbox[k] is None for k in ("scheduled_date","planned_start_at","planned_end_at","planning_window","window_start"))
    assert move(inbox,scheduled_date=None).json()["change_id"] is None
    assert move(inbox,title="Unexpected").status_code==422


def test_http_access_export_and_rollback(http):
    client, root = http
    assert client.get("/api/health").json() == {"status": "ok"}
    assert client.get("/api/auth/status").json()["authenticated"] is False
    assert client.get("/api/tasks").status_code == 401
    assert client.post("/api/auth/login", json={"password": "wrong"}).status_code == 401
    secret = login(client, root)
    assert client.post("/api/tasks", headers={"Origin": "https://another.example"}, json={"title": "reject"}).status_code == 403
    assert client.post("/api/tasks", json={"title": "关联不存在", "resource_ids": [9999]}).status_code == 422
    assert client.get("/api/changes").json() == []
    result = client.post("/api/tasks", json={"title": "先记录"})
    assert result.status_code == 201
    tid = result.json()["id"]
    assert client.patch(f"/api/tasks/{tid}", json={"status": "invented"}).status_code == 422
    assert client.delete(f"/api/tasks/{tid}").status_code == 409
    assert client.get("/api/tasks?view=inbox").json()[0]["id"] == tid
    exported = client.get("/api/export")
    assert exported.json()["tasks"][0]["title"] == "先记录"
    assert secret not in exported.text and "password_hash" not in exported.text and "ai_providers" not in exported.text
    assert client.delete(f"/api/tasks/{tid}?confirm=true").status_code == 200
    log = client.get("/api/changes").json()[0]
    assert client.post(f"/api/changes/{log['id']}/undo").json()["record"]["id"] == tid
    assert client.post("/api/auth/logout").json() == {"authenticated": False}
    assert client.get("/api/export").status_code == 401


def test_accounts_isolate_records_files_settings_and_session_identity(http):
    from app.main import app
    first, root = http
    identity = register(first, root, "Alice", "password-for-alice").json()["account"]
    assert identity["username"] == "alice"
    assert first.post("/api/tasks", json={"title": "Alice only"}).status_code == 201
    assert first.post("/api/projects", json={"name": "Alice project"}).status_code == 201
    uploaded = first.post("/api/resources/upload", files={"file": ("private.md", b"Alice attachment")}).json()
    assert first.patch("/api/settings", json={"language": "ja"}).status_code == 200
    assert first.patch("/api/ai/providers/compatible", json={"api_key": "alice-private-key"}).status_code == 200

    with TestClient(app) as second:
        assert second.get("/api/tasks").status_code == 401
        response = register(second, root, "bob", "password-for-bob")
        assert response.status_code == 201, response.text
        assert response.json()["account"]["id"] != identity["id"]
        for path in ("/api/tasks", "/api/projects", "/api/resources", "/api/changes", "/api/ai/conversations"):
            assert second.get(path).json() == []
        assert second.get(uploaded["file_url"]).status_code == 404
        assert second.get("/api/settings").json()["language"] == "zh-CN"
        assert not next(row for row in second.get("/api/ai/providers").json() if row["id"] == "compatible")["has_key"]
        assert second.post("/api/tasks", headers={"X-DayWeave-Account": identity["id"]},
                           json={"title": "Stale tab write"}).status_code == 401
        bob_task = second.post("/api/tasks", json={"title": "Bob only"}).json()
        assert bob_task["id"] == first.get("/api/tasks").json()[0]["id"]
        assert second.get("/api/export").json()["tasks"][0]["title"] == "Bob only"
    assert first.get("/api/export").json()["tasks"][0]["title"] == "Alice only"
    assert first.get(uploaded["file_url"]).content == b"Alice attachment"
    assert not (root / "admin-password.txt").exists()


def test_shared_workspaces_keep_assistant_profiles_and_conversations_private(http, monkeypatch):
    import json
    import httpx
    from app.ai.adapters import Adapter
    from app.main import app

    def simulate(request):
        payload = json.loads(request.content)
        draft = {"index": 0, "id": "task-proposal", "type": "function",
                 "function": {"name": "create_task", "arguments": '{"title":"Shared assistant task"}'}}
        choice = {"index": 0, "delta": {"tool_calls": [draft]}, "finish_reason": "tool_calls"} if payload.get("tools") else {
            "index": 0, "delta": {"content": "Draft prepared."}, "finish_reason": "stop"
        }
        return httpx.Response(200, text="data: " + json.dumps({"choices": [choice]}) + "\n\ndata: [DONE]\n\n")

    monkeypatch.setattr(Adapter, "client", lambda self: httpx.Client(transport=httpx.MockTransport(simulate)))
    alice, root = http
    assert register(alice, root, "alice", "alice-password-22").status_code == 201
    personal = alice.get("/api/workspaces").json()[0]
    shared = alice.post("/api/workspaces", json={"name": "Shared work"}).json()
    assert len(alice.get("/api/workspaces").json()) == 2
    view = {"X-DayWeave-Workspace": shared["id"]}
    assert alice.post("/api/tasks", headers=view, json={"title": "Shared task"}).status_code == 201
    assert alice.get("/api/tasks", headers={"X-DayWeave-Workspace": personal["id"]}).json() == []
    assert alice.patch("/api/ai/providers/compatible", json={
        "api_key": "alice-profile-token", "base_url": "https://fixture.example/v1", "model": "shared-fixture",
    }).status_code == 200
    with TestClient(app) as bob:
        actor = register(bob, root, "bob", "bob-password-111").json()["account"]
        assert bob.get("/api/tasks", headers=view).status_code == 401
        assert alice.post(f"/api/workspaces/{shared['id']}/members", json={"username": "bob"}).status_code == 201
        assert bob.get("/api/tasks", headers=view).json()[0]["title"] == "Shared task"
        assert bob.post(f"/api/workspaces/{shared['id']}/members", json={"username": "admin"}).status_code == 404
        alice_providers = alice.get("/api/ai/providers", headers=view).json()
        bob_providers = bob.get("/api/ai/providers", headers=view).json()
        assert next(p for p in alice_providers if p["id"] == "compatible")["has_key"]
        assert not next(p for p in bob_providers if p["id"] == "compatible")["has_key"]
        reply = alice.post("/api/ai/chat", headers=view, json={
            "provider": "compatible", "content": "Create a shared task", "request_id": "scoped-request-123",
        })
        assert reply.status_code == 200, reply.text
        frames = [json.loads(line[6:]) for line in reply.text.splitlines() if line.startswith("data: {")]
        draft = next(event for event in frames if event["type"] == "task_draft")
        conversation = next(event for event in frames if event["type"] == "conversation")
        assert bob.get(f"/api/ai/conversations/{conversation['id']}", headers=view).status_code == 404
        assert bob.get(f"/api/ai/confirmations/{draft['id']}", headers=view).status_code == 404
        assert bob.get("/api/export", headers=view).json()["messages"] == []
        assert len(bob.get("/api/tasks", headers=view).json()) == 1
        approved = alice.post(f"/api/ai/confirmations/{draft['id']}", headers=view,
                              json={"approve": True, "version": draft["version"]})
        assert approved.status_code == 200, approved.text
        assert len(bob.get("/api/tasks", headers=view).json()) == 2
        assert alice.delete(f"/api/workspaces/{shared['id']}/members/{actor['id']}").status_code == 204
        assert bob.get("/api/tasks", headers=view).status_code == 401


@pytest.mark.parametrize("path", ["/api/ai/transcribe", "/api/resources/upload"])
def test_authenticated_upload_rejects_before_receiving_body(http, path):
    client, _ = http

    def body():
        pytest.fail("Request body was read from an unauthenticated upload")
        yield b""

    response = client.post(path, content=body(), headers={"Content-Type": "multipart/form-data; boundary=test"})
    assert response.status_code == 401
    assert response.json()["code"] == "auth.required"


def test_multipart_upload_and_link(http):
    client, root = http
    login(client, root)
    for name, data in [("unsafe.exe", b"X"), ("masquerade.pdf", b"Hello"), ("broken.md", b"a\x00b")]:
        assert client.post("/api/resources/upload", files={"file": (name, data)}).status_code == 422
    pdf = b"%PDF-1.4\n% Test document fixture\n%%EOF\n"
    upload = client.post("/api/resources/upload", files={"file": ("papers/学习.pdf", pdf, "application/pdf")})
    assert upload.status_code == 201, upload.text
    resource = upload.json()
    assert resource["title"] == "学习.pdf" and resource["position_unit"] == "pages"
    assert len(list((root / "workspaces").glob("*/uploads/*"))) == 1
    raw = client.get(resource["file_url"])
    assert raw.content == pdf and raw.headers["Content-Type"] == "application/pdf"
    updated = client.patch(f"/api/resources/{resource['id']}", json={"current_position": 3, "total_pages": 10})
    assert updated.json()["current_position"] == 3
    task = client.post("/api/tasks", json={"title": "阅读资料", "resource_ids": [resource["id"]]}).json()
    linked = client.get(f"/api/tasks/{task['id']}").json()["resource_ids"]
    assert client.get(f"/api/resources/{linked[0]}").json()["file_url"] == resource["file_url"]
    client.post("/api/auth/logout")
    assert client.get(resource["file_url"]).status_code == 401


def test_language_negotiation_persistence_and_localized_errors(http):
    client, root = http
    headers = {"Accept-Language": "fr-FR, en-US;q=0.7, ja-JP;q=0.95"}
    feedback = client.post("/api/auth/login", headers=headers, json={"password": "incorrect"})
    assert feedback.headers["Content-Language"] == "ja"
    assert feedback.json() == {"code": "auth.invalid_password", "detail": "ユーザー名またはパスワードが正しくありません。"}
    fallback = client.get("/api/tasks", headers={"Accept-Language": "de, en;q=0"})
    assert fallback.json()["detail"] == "请登录 DayWeave"
    login(client, root)
    original_title = "A real task / 実際のタスク"
    tid = client.post("/api/tasks", json={"title": original_title}).json()["id"]
    for locale, message in [("en", "Confirm the deletion first."), ("ja", "削除する前に確認してください。"),
                            ("zh-CN", "删除前请先确认")]:
        assert client.patch("/api/settings", json={"language": locale}).json()["language"] == locale
        assert client.get("/api/settings").json()["language"] == locale
        blocked = client.delete(f"/api/tasks/{tid}", headers={"Accept-Language": "en-US"})
        assert blocked.headers["Content-Language"] == locale
        assert blocked.json() == {"code": "record.confirm_delete", "detail": message}
    client.patch("/api/settings", json={"language": "ja"})
    invalid = client.patch("/api/settings", json={"language": "xx"})
    assert invalid.status_code == 422
    assert invalid.json()["errors"] == [{"field": "language", "code": "settings.invalid_language",
                                        "detail": "簡体字中国語、英語、日本語のいずれかを選んでください。"}]
    assert client.get("/api/settings").json()["language"] == "ja"
    conflict = client.patch(f"/api/tasks/{tid}", json={"due_date": "2030-10-01", "scheduled_date": "2030-10-02"})
    assert conflict.json()["code"] == "time.due_conflict" and "期限" in conflict.json()["detail"]
    item = client.get(f"/api/tasks/{tid}").json()
    assert item["title"] == original_title and item["status"] == "todo"

def test_email_ownership_and_password_recovery(http, monkeypatch):
    from app import email_codes
    from app.main import app
    client, root = http
    email = "owner@example.org"
    credentials = {"email": email.upper(), "username": "owner", "password": PASSWORD}
    assert client.post("/api/auth/register", json=credentials).status_code == 422
    request = {"email": email, "purpose": "register"}
    with monkeypatch.context() as outage:
        def unavailable(*args):
            raise ConnectionResetError()
        outage.setattr(email_codes.MailServer, "send", unavailable)
        for address in (email, "admin@example.org"):
            failed = client.post("/api/auth/email-code", json={**request, "email": address})
            assert failed.status_code == 503 and failed.json()["code"] == "auth.mail_delivery_failed"
    assert client.post("/api/auth/email-code", json=request).json() == {"accepted": True}
    register_code = (root / (email + ".register")).read_text()
    assert client.post("/api/auth/email-code", json=request).status_code == 202
    assert (root / (email + ".register")).read_text() == register_code
    wrong = ("0" if register_code[0] != "0" else "1") + register_code[1:]
    assert client.post("/api/auth/register", json={**credentials, "code": wrong}).status_code == 400
    assert client.post("/api/auth/register", json={**credentials, "code": register_code}).json()["account"]["email"] == email
    assert client.post("/api/auth/register", json={**credentials, "code": register_code}).status_code == 400
    task = client.post("/api/tasks", json={"title": "Retained after recovery"}).json()
    with TestClient(app) as visitor:
        unknown = visitor.post("/api/auth/email-code", json={"email": "unknown@example.org", "purpose": "reset"})
        known = visitor.post("/api/auth/email-code", json={"email": email, "purpose": "reset"})
        assert unknown.status_code == known.status_code == 202 and unknown.json() == known.json()
        assert not (root / "unknown@example.org.reset").exists()
        reset_code = (root / (email + ".reset")).read_text()
        reset = {"email": email.upper(), "password": "replacement-test-secret", "code": reset_code}
        assert visitor.post("/api/auth/reset-password", json=reset).status_code == 204
        assert visitor.post("/api/auth/reset-password", json=reset).status_code == 400
        assert client.get("/api/tasks").status_code == 401
        assert visitor.get("/api/tasks").status_code == 401
        assert visitor.post("/api/auth/login", json={"username": email, "password": PASSWORD}).status_code == 401
        assert visitor.post("/api/auth/login", json={"username": email, "password": reset["password"]}).status_code == 200
        assert visitor.get("/api/tasks").json()[0]["id"] == task["id"]
        visitor.post("/api/auth/email-code", json={"email": email, "purpose": "reset"})
        reset["code"] = (root / (email + ".reset")).read_text()
        monkeypatch.setattr(email_codes, "TTL", 0)
        assert visitor.post("/api/auth/reset-password", json=reset).status_code == 400


def test_codex_login_is_private_and_chat_creates_tasks_only_on_confirmation(http, monkeypatch):
    """Exercise the browser's login, polling, chat, draft edit and disconnect requests."""
    import json
    from contextlib import contextmanager
    from queue import Queue
    from time import monotonic, sleep
    from app.ai import codex_provider
    from app.main import app

    client, root = http
    login(client, root)
    workspace = client.get("/api/workspaces").json()[0]
    scope = {"X-DayWeave-Workspace": workspace["id"]}
    messages = Queue()
    auth = '{"auth_mode":"chatgpt","tokens":{"access_token":"private-grant","refresh_token":"fixture-only"}}'
    catalog_ready = False

    class FixtureRPC:
        cwd = root
        auth_file = root / "fixture-grant.json"
        notifications = []

        def call(self, method, params):
            if method == "account/login/start":
                assert params == {"type": "chatgptDeviceCode"}
                self.auth_file.write_text(auth)
                return {"loginId": "test", "verificationUrl": "https://auth.openai.com/codex/device", "userCode": "TEST-CODE"}
            if method == "thread/start":
                assert params["ephemeral"] and params["environments"] == [] and params["sandbox"] == "read-only"
                return {"thread": {"id": "t"}}
            assert method == "turn/start"
            assert params["outputSchema"]["type"] == "object"
            return {"turn": {"id": "turn"}}

        def models(self):
            if not catalog_ready:
                raise codex_provider.ProviderError("Model catalog unavailable")
            return [{"id": "fixture-model", "name": "Fixture", "default": True, "efforts": ["low"]}]

        def events(self, deadline):
            text = json.dumps({"calls": [{"name": "create_task", "arguments": json.dumps({"title": "Draft from Codex"})}]})
            for value in (6, 10):
                yield {"method": "thread/tokenUsage/updated", "params": {"turnId": "turn", "threadId": "t",
                       "tokenUsage": {"total": {"inputTokens": value, "outputTokens": 2, "totalTokens": value + 2}}}}
            yield {"method": "item/completed", "params": {"turnId": "turn", "item": {"type": "agentMessage", "text": text}}}
            yield {"method": "turn/completed", "params": {"turn": {"id": "turn", "status": "completed"}}}

    @contextmanager
    def transport(grant=None):
        rpc = FixtureRPC()
        rpc.messages = messages
        if grant is not None:
            assert grant == auth
        yield rpc

    monkeypatch.setattr(codex_provider, "runtime", transport)
    with TestClient(app) as peer:
        assert register(peer, root, "peer", "peer-password-123").status_code == 201
        assert client.post(f"/api/workspaces/{workspace['id']}/members", json={"username": "peer"}).status_code == 201
        flow = client.post("/api/ai/codex/login", headers=scope)
        assert flow.json()["user_code"] == "TEST-CODE" and flow.headers["Cache-Control"] == "no-store"
        assert peer.get("/api/ai/codex/login", headers=scope).json() == {"state": "idle"}
        def final_state():
            deadline = monotonic() + 5
            while monotonic() < deadline:
                result = client.get("/api/ai/codex/login", headers=scope).json()
                if result["state"] in {"failed", "connected"}:
                    return result
                sleep(0.025)
            raise AssertionError("The device flow never finished")

        messages.put({"method": "account/login/completed", "params": {
            "loginId": "test", "success": False, "error": "403 Forbidden private diagnostic"}})
        assert final_state() == {"state": "failed", "reason": "exchange_forbidden"}
        assert not next(p for p in client.get("/api/ai/providers").json() if p["id"] == "codex")["has_key"]
        assert client.post("/api/ai/codex/login", headers=scope).json()["state"] == "pending"
        messages.put({"method": "account/login/completed", "params": {"loginId": "another-flow", "success": False}})
        messages.put({"method": "account/login/completed", "params": {"loginId": None, "success": True}})
        assert final_state() == {"state": "connected"}, "An approved login was discarded"
        providers = client.get("/api/ai/providers", headers=scope)
        assert "private-grant" not in providers.text and "TEST-CODE" not in providers.text
        saved = next(p for p in providers.json() if p["id"] == "codex")
        assert saved["has_key"] and not saved["models"]
        assert client.post("/api/ai/codex/login", headers=scope).json()["state"] == "connected"
        catalog_ready = True
        refreshed = client.post("/api/ai/providers/codex/test", headers=scope).json()
        assert refreshed["models"] == ["fixture-model"] and refreshed["model"] == "fixture-model"
        assert not next(p for p in peer.get("/api/ai/providers", headers=scope).json() if p["id"] == "codex")["has_key"]
        response = client.post("/api/ai/chat", headers=scope, json={"provider": "codex", "request_id": "codex-test-request", "content": "Create a task"})
        frames = [json.loads(line[6:]) for line in response.text.splitlines() if line.startswith("data: {")]
        usage = [frame["usage"] for frame in frames if frame["type"] == "usage"][-1]
        assert usage == {"input_tokens": 10, "output_tokens": 2, "total_tokens": 12, "partial": False}
        draft = next(frame for frame in frames if frame["type"] == "task_draft")
        url = f"/api/ai/confirmations/{draft['id']}"
        assert peer.get(url, headers=scope).status_code == 404
        assert client.get("/api/tasks", headers=scope).json() == []
        edited = client.patch(url + "/draft", headers=scope, json={"version": draft["version"], "drafts": [{"index": 0, "task": {"title": "Edited Codex task"}}]})
        assert edited.status_code == 200 and client.get("/api/tasks", headers=scope).json() == []
        assert client.post(url, headers=scope, json={"approve": True, "version": edited.json()["version"]}).status_code == 200
        assert [row["title"] for row in peer.get("/api/tasks", headers=scope).json()] == ["Edited Codex task"]
        assert client.post("/api/ai/codex/disconnect").status_code == 204
        assert client.get("/api/ai/codex/login", headers=scope).json() == {"state": "idle"}
