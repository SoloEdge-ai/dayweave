"""Serve the real app on loopback with disposable data and a local model simulator."""
import argparse
import json
import os
from pathlib import Path
import secrets
import sys
import tempfile
import threading
from types import SimpleNamespace

ROOT = Path(__file__).resolve().parents[2]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--port", type=int, default=18787)
args = parser.parse_args()
if not (ROOT / "frontend/dist/index.html").exists():
    raise SystemExit("Build the frontend before starting the browser fixture.")


def run(directory):
    os.environ["DAYWEAVE_DATA_DIR"] = directory
    password = secrets.token_urlsafe(24)
    os.environ["DAYWEAVE_STATIC_DIR"] = str(ROOT / "frontend/dist")
    os.environ["DAYWEAVE_COOKIE_SECURE"] = "0"
    os.chdir(ROOT / "backend")
    sys.path.insert(0, str(ROOT / "backend"))
    import httpx
    from alembic import command
    from alembic.config import Config
    # Initialize native audio dependencies before waiting for the parent pipe on Windows.
    import faster_whisper  # noqa: F401
    import uvicorn
    from app.ai.adapters import Adapter
    from app.ai import voice

    if not os.getenv("DAYWEAVE_TEST_VOICE_WAV"):
        # Keep HTTP upload, decoding and the composer real in the repeatable UI run.
        class FixtureSpeech:
            def transcribe(self, waveform, *, language, **kwargs):
                assert len(waveform) > 0
                return [SimpleNamespace(text="请为机器人跟踪创建一个任务。")], SimpleNamespace(language=language)

        voice.model = FixtureSpeech

    def simulate(request):
        if request.url.path.endswith("/models"):
            return httpx.Response(200, json={"data": [{"id": "dayweave-fixture"}]})
        if request.url.path.endswith("/chat/completions"):
            body = json.loads(request.content)
            assert body["model"] == "dayweave-fixture"
            system_text = " ".join(m["content"] for m in body["messages"] if m["role"] == "system")
            language = "en" if "Answer in English" in system_text else "ja" if "Answer in Japanese" in system_text else "zh"
            replies = {"zh": "本地测试连接成功。", "en": "The test connection is working.",
                       "ja": "テスト接続に成功しました。"}
            choice = {"index": 0, "delta": {"content": replies[language]}, "finish_reason": "stop"}
            latest_user = next(m["content"] for m in reversed(body["messages"]) if m["role"] == "user")
            voice_task = "机器人" in latest_user and "任务" in latest_user
            issue_link = "https://tracker.example.test/browse/ROS-23"
            linked_task = issue_link in latest_user and latest_user.strip() != issue_link
            if body.get("tools") and (voice_task or linked_task or "ROS2 tracing" in latest_user):
                if linked_task:
                    name = "create_task"
                    arguments = {"title": "ROS2 tracing 取消用例", "links": [{"url": issue_link}]}
                elif voice_task:
                    name = "create_task"
                    arguments = {"title": "机器人跟踪", "estimated_minutes": 30}
                elif "标记完成" in latest_user:
                    name = "complete_task"
                    arguments = {"query": latest_user.removeprefix("把").removesuffix("标记完成").strip()}
                else:
                    name = "create_task"
                    titles = {"en": "ROS2 tracing exercise", "ja": "ROS2 tracing の演習", "zh": "ROS2 tracing 学习笔记"}
                    title = "ROS2 tracing 取消用例" if "取消用例" in latest_user else titles[language]
                    arguments = {"title": title, "scheduled_date": "明天",
                                 "scheduled_period": "afternoon", "due_date": "周五", "estimated_minutes": 60}
                    issue = "https://tracker.example.test/browse/ROS-21"
                    if issue in latest_user:
                        arguments["links"] = [{"url": issue}]
                tool = {"index": 0, "id": "fixture-call", "type": "function",
                        "function": {"name": name, "arguments": json.dumps(arguments, ensure_ascii=False)}}
                choice = {"index": 0, "delta": {"tool_calls": [tool]}, "finish_reason": "tool_calls"}
            assert body["stream_options"]["include_usage"] is True
            frame = json.dumps({"choices": [choice]}, ensure_ascii=False)
            meter = json.dumps({"choices": [], "usage": {"prompt_tokens": 32, "completion_tokens": 8, "total_tokens": 40}})
            return httpx.Response(200, text=f"data: {frame}\n\ndata: {meter}\n\ndata: [DONE]\n\n",
                                  headers={"Content-Type": "text/event-stream"})
        return httpx.Response(404)

    Adapter.client = lambda self: httpx.Client(transport=httpx.MockTransport(simulate))
    command.upgrade(Config("alembic.ini"), "head")
    from app.main import app
    from app.auth import add_account
    from app.ai.codex_provider import CodexAdapter
    from app.ai.providers import provider
    from app.ai.secrets import seal
    from app.db import SessionLocal, profile_dir, stored_session
    with SessionLocal.begin() as db:
        add_account(db, "admin", "admin@example.org", password)
        picker = add_account(db, "model-picker", "model-picker@example.org", password)
        with stored_session(profile_dir(picker.id)) as profile, profile.begin():
            codex = provider(profile, "codex")
            codex.secret, codex.status = seal("fixture-only"), "connected"
    # This account has an approved grant and is still waiting for its first model catalog.
    CodexAdapter.list_models = lambda self: [
        {"id": "fixture-fast", "name": "Fixture Fast", "efforts": ["low"], "default": True},
        {"id": "fixture-deep", "name": "Fixture Deep", "efforts": ["medium", "high"]},
    ]
    output = Path(directory) / "browser-access.json"
    output.write_text(json.dumps({"password": password, "mailbox": str(Path(directory) / "mail.jsonl")}), encoding="utf-8")
    print(f"DAYWEAVE_FIXTURE={output}", flush=True)
    server = uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=args.port, access_log=False, log_level="warning"))
    def stop_on_parent_exit():
        # A buffered stdin read can hold a lock during NumPy's Windows initialization.
        while os.read(sys.stdin.fileno(), 1):
            pass
        server.should_exit = True
    threading.Thread(target=stop_on_parent_exit, daemon=True).start()
    server.run()
    from app.db import engine
    engine.dispose()


if __name__ == "__main__":
    from mailbox_fixture import mailbox
    with tempfile.TemporaryDirectory(prefix="dayweave-browser-") as fixture, mailbox(fixture):
        run(fixture)
