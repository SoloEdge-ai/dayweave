"""Exercise the actual ASGI app, migrations, authentication, and file storage."""
from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker


@pytest.fixture
def http(tmp_path, monkeypatch):
    from app import auth, db, main
    monkeypatch.setenv("DAYWEAVE_DATA_DIR", str(tmp_path))
    monkeypatch.delenv("DAYWEAVE_ADMIN_PASSWORD", raising=False)
    engine = create_engine(db.sqlite_url(), connect_args={"check_same_thread": False})
    event.listen(engine, "connect", db.configure_sqlite)
    sessions = sessionmaker(engine, expire_on_commit=False)
    monkeypatch.setattr(db, "engine", engine)
    monkeypatch.setattr(main, "engine", engine)
    for module in (auth, db, main):
        monkeypatch.setattr(module, "SessionLocal", sessions)
    config = Config(str(Path(__file__).resolve().parents[1] / "alembic.ini"))
    command.upgrade(config, "head")
    command.upgrade(config, "head")
    with TestClient(main.app) as client:
        yield client, tmp_path
    engine.dispose()


def login(client, root):
    secret = (root / "admin-password.txt").read_text(encoding="utf-8").strip()
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
    assert len(list((root / "uploads").iterdir())) == 1
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
    assert feedback.json() == {"code": "auth.invalid_password", "detail": "管理者パスワードが正しくありません。"}
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
