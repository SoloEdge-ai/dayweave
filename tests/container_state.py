"""Run inside a disposable Compose installation before and after a restart."""
from http.server import BaseHTTPRequestHandler, HTTPServer
import json
import os
import sys
from threading import Thread
from uuid import uuid4

import httpx

client = httpx.Client(base_url="http://127.0.0.1:8000", timeout=15, trust_env=False)
client.post("/api/auth/login", json={"password": os.environ["DAYWEAVE_ADMIN_PASSWORD"]}).raise_for_status()
title = "Persistent task"
sample = b"%PDF-1.4\n% DayWeave storage check\n%%EOF"
video_url = "https://www.youtube.com/watch?v=DayWeaveTest"


def api(method, path, data=None):
    response = client.request(method, "/api/" + path, json=data)
    response.raise_for_status()
    return response.json()


class Provider(BaseHTTPRequestHandler):
    def log_message(self, *_):
        pass

    def do_GET(self):
        assert self.path == "/v1/models"
        self.send_response(200)
        self.end_headers()
        self.wfile.write(b'{"data":[{"id":"persistence-fixture"}]}')

    def do_POST(self):
        assert self.path == "/v1/chat/completions"
        self.rfile.read(int(self.headers["Content-Length"]))
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.end_headers()
        choice = {"index": 0, "delta": {"content": "Persistence confirmed."}, "finish_reason": "stop"}
        self.wfile.write(("data: " + json.dumps({"choices": [choice]}) + "\n\ndata: [DONE]\n\n").encode())


if sys.argv[1] == "seed":
    project = api("POST", "projects", {"name": "Persistence check"})
    resource = api("POST", "resources", {"title": "Video", "type": "video", "url": video_url,
                                         "current_position": 62, "project_ids": [project["id"]]})
    upload = client.post("/api/resources/upload", files={"file": ("fixture.pdf", sample, "application/pdf")})
    upload.raise_for_status()
    api("POST", "tasks", {"title": title, "project_id": project["id"],
                          "resource_ids": [resource["id"], upload.json()["id"]]})
    api("PATCH", "settings", {"timezone": "Pacific/Auckland", "theme": "dark"})
    server = HTTPServer(("127.0.0.1", 19197), Provider)
    Thread(target=server.serve_forever, daemon=True).start()
    api("PATCH", "ai/providers/compatible", {"base_url": "http://127.0.0.1:19197/v1",
                                            "api_key": "disposable-credential", "model": "persistence-fixture"})
    assert api("POST", "ai/providers/compatible/test")["status"] == "connected"
    response = client.post("/api/ai/chat", json={"request_id": str(uuid4()), "content": "Check persistence.",
                                                "provider": "compatible", "model": "persistence-fixture"})
    response.raise_for_status()
    assert "Persistence confirmed." in response.text, response.text
    server.shutdown()

records = api("GET", "export")
task = next(t for t in records["tasks"] if t["title"] == title)
assert len(task["resource_ids"]) == 2
project = next(p for p in records["projects"] if p["name"] == "Persistence check")
assert task["project_id"] == project["id"]
assert records["settings"]["timezone"] == "Pacific/Auckland"
assert any(m["content"] == "Persistence confirmed." for m in records["messages"])
assert "disposable-credential" not in json.dumps(records)
assert any(r["url"] == video_url and r["current_position"] == 62 and project["id"] in r["project_ids"]
           for r in records["resources"])
pdf = next(r for r in records["resources"] if r["type"] == "pdf")
assert client.get(pdf["file_url"]).content == sample
compatible = next(p for p in api("GET", "ai/providers") if p["id"] == "compatible")
assert compatible["has_key"] and compatible["model"] == "persistence-fixture"
print("Verified task, project, video position, upload bytes, settings and chat history.")
