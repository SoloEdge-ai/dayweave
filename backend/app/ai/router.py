import json
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from fastapi.responses import StreamingResponse
from pydantic import Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app import services
from app.db import get_db, stream_sessions

from . import drafts, oauth
from .adapters import DEFAULTS, efforts
from .agent import confirm, reserve, run
from .locale import preference, translate
from .models import ChatTurn, Conversation, Message, PendingAction
from .providers import ProviderPatch, configure, provider, public, test_provider
from .tools import Params

router = APIRouter(prefix="/api/ai", tags=["ai"])
DB = Annotated[Session, Depends(get_db)]


class ChatRequest(Params):
    content: str = Field(min_length=1, max_length=8000)
    provider: str | None = None
    model: str | None = Field(None, max_length=180)
    reasoning: str | None = Field(None, max_length=40)
    conversation_id: int | None = Field(None, gt=0)
    request_id: str = Field(min_length=8, max_length=64, pattern=r"^[a-zA-Z0-9_-]+$")


class Decision(Params):
    approve: bool
    version: int | None = Field(None, ge=1)
    allow_due_conflict: bool = False


@router.get("/providers")
def providers(db: DB):
    lang = preference(db)
    return [public(provider(db, k), lang) for k in DEFAULTS]


@router.patch("/providers/{pid}")
def edit_provider(pid: str, change: ProviderPatch, db: DB):
    return configure(db, provider(db, pid), change)


@router.post("/providers/{pid}/test")
def test_connection(pid: str, db: DB):
    return test_provider(db, provider(db, pid))


@router.get("/models")
def models(
    db: DB,
    provider_id: Annotated[str, Query(alias="provider")],
    model: str | None = None,
):
    p = provider(db, provider_id)
    return {
        "models": [m["id"] for m in p.catalog],
        "catalog": p.catalog,
        "efforts": efforts(p.id, model or p.model, p.catalog),
    }


@router.post("/codex/login")
def codex_login(db: DB, response: Response):
    from . import codex_provider
    response.headers["Cache-Control"] = "no-store"
    if provider(db, "codex").secret:
        return {"state": "connected"}
    db.commit()
    return codex_provider.start(db.info["profile_dir"])


@router.get("/codex/login")
def codex_login_status(db: DB, response: Response):
    from . import codex_provider
    response.headers["Cache-Control"] = "no-store"
    if provider(db, "codex").secret:
        return {"state": "connected"}
    return codex_provider.status(db.info["profile_dir"])


@router.post("/codex/disconnect", status_code=204)
def codex_disconnect(db: DB):
    from . import codex_provider
    db.commit()
    codex_provider.disconnect(db.info["profile_dir"])


@router.get("/chatgpt/guide")
def guide(db: DB):
    doc = {
        "steps": [
            "此接入面向符合官方条件的开源本地应用或已获准的客户端，账号与工作区资格由 OpenAI 验证。",
            "按项目文档在服务器生成接收描述文件。在浏览器所在电脑运行 DayWeave 授权助手，选择 Continue with ChatGPT 并授权。",
            "通过 SSH 传送加密授权文件，并在服务器导入。回到设置点击测试连接，加载当前账号可用的模型。",
        ],
        "documentation": "https://developers.openai.com/siwc/token-sharing-open-source/self-hosted-vms",
        "local_documentation": "docs/AI_PROVIDERS.md",
    }
    doc["steps"] = [translate(s, preference(db)) for s in doc["steps"]]
    return doc


@router.post("/chatgpt/disconnect")
def disconnect(db: DB):
    row = provider(db, "chatgpt")
    oauth.revoke(db, row)
    return public(row, preference(db))


@router.get("/conversations")
def conversations(db: DB):
    return [
        {"id": c.id, "title": c.title, "created_at": c.created_at}
        for c in db.scalars(select(Conversation).order_by(Conversation.id.desc()))
    ]


@router.get("/conversations/{cid}")
def conversation(cid: int, db: DB):
    conv = db.get(Conversation, cid)
    if not conv:
        raise HTTPException(404, "会话不存在。")
    for pending in db.scalars(
        select(PendingAction).where(
            PendingAction.conversation_id == cid, PendingAction.status == "pending"
        )
    ):
        if drafts.is_draft(pending):
            drafts.get(db, pending.id)
    rows = db.scalars(
        select(Message).where(Message.conversation_id == cid).order_by(Message.id)
    )
    return {
        "id": conv.id,
        "title": conv.title,
        "created_at": conv.created_at,
        "messages": [
            {
                k: getattr(m, k)
                for k in (
                    "id",
                    "role",
                    "content",
                    "created_at",
                    "model",
                    "provider",
                    "tools",
                )
            }
            for m in rows
        ],
    }


def events(factory, req, turn_id, lease, replay):
    with factory() as session:
        turn = session.get(ChatTurn, turn_id)
        if replay:
            msg = session.get(Message, turn.message_id)
            yield {"type": "conversation", "id": turn.conversation_id}
            yield from msg.tools
            if turn.state == "done":
                yield {"type": "delta", "text": msg.content}
            yield {"type": "done"}
        else:
            yield from run(session, turn, req, lease)


@router.post("/chat")
def chat(req: ChatRequest, db: DB):
    turn, replay = reserve(db, req, services.get_settings(db))
    turn_id, lease = turn.id, turn.lease
    db.commit()
    factory = stream_sessions(db)

    def stream():
        for event in events(factory, req, turn_id, lease, replay):
            yield "data: " + json.dumps(event, ensure_ascii=False, default=str) + "\n\n"

    return StreamingResponse(
        stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no"},
    )


@router.post("/confirmations/{pending_id}")
def confirmation(pending_id: int, body: Decision, db: DB):
    return confirm(db, pending_id, body.approve, body.version, body.allow_due_conflict)


@router.get("/confirmations/{pending_id}")
def get_confirmation(pending_id: int, db: DB):
    row = drafts.get(db, pending_id)
    if drafts.is_draft(row):
        return drafts.event(row)
    return {
        "type": "confirmation",
        "id": row.id,
        "summary": row.summary,
        "status": row.status,
    }


@router.patch("/confirmations/{pending_id}/draft")
def edit_draft(pending_id: int, body: drafts.DraftPatch, db: DB):
    return drafts.edit(db, pending_id, body)
