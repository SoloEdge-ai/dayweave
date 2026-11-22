import os
from contextlib import asynccontextmanager
from pathlib import Path
from urllib.parse import urlsplit

from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, JSONResponse
from pydantic import ValidationError
from sqlalchemy import text
from starlette.datastructures import Headers, MutableHeaders
from starlette.exceptions import HTTPException as StarletteHTTPException
from starlette.concurrency import run_in_threadpool

from . import api, auth, workspaces
from .ai.router import router as ai_router
from .ai.voice import MAX_AUDIO, router as voice_router
from .db import SessionLocal, engine, open_workspace
from .i18n import DomainError, error_info, normalize_language, request_locale, validation_info
from .models import Settings
from .uploads import MAX_UPLOAD


@asynccontextmanager
async def lifespan(_):
    with SessionLocal.begin() as db:
        auth.initialize_accounts(db)
    yield


app = FastAPI(title="DayWeave", lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)


def error_locale(request):
    # Request parsing and the size/origin guard may run before the auth dependency.
    if getattr(request.state, "language", None) is None and request.cookies.get(auth.COOKIE):
        with SessionLocal() as db:
            workspace = auth.current_workspace(request, db)
        if workspace:
            with open_workspace(workspace.workspace_id, workspace.account_id, owner=workspace.owner) as db:
                settings = db.get(Settings, 1)
                request.state.language = normalize_language(settings.language if settings else None)
    return request_locale(request)


def upload_authorized(request):
    with SessionLocal() as db:
        return auth.current_workspace(request, db) is not None


class RequestGuard:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        headers = Headers(scope=scope)
        unsafe = scope["method"] not in {"GET", "HEAD", "OPTIONS"}
        def reject(status, code):
            language = error_locale(Request(scope))
            return JSONResponse(error_info(DomainError(status, code), language), status_code=status,
                                headers={"Content-Language": language, "Cache-Control": "no-store"})

        if unsafe and headers.get("origin"):
            try:
                origin = urlsplit(headers["origin"])
                matches = origin.netloc.lower() == headers.get("host", "").lower() and origin.scheme == scope["scheme"]
            except ValueError:
                matches = False
            if not matches:
                return await reject(403, "request.origin")(scope, receive, send)
        large_uploads = {"/api/resources/upload": MAX_UPLOAD, "/api/ai/transcribe": MAX_AUDIO}
        limit = large_uploads[scope["path"]] + 128 * 1024 if scope["path"] in large_uploads else 1024 * 1024
        content_length = headers.get("content-length", "0")
        if not content_length.isdigit() or int(content_length) > limit:
            return await reject(413, "request.too_large")(scope, receive, send)
        if scope["method"] == "POST" and scope["path"] in large_uploads:
            if not await run_in_threadpool(upload_authorized, Request(scope)):
                return await reject(401, "auth.required")(scope, receive, send)
        total = 0

        async def limited_receive():
            nonlocal total
            message = await receive()
            total += len(message.get("body", b""))
            if total > limit:
                raise DomainError(413, "request.too_large")
            return message

        async def add_headers(message):
            if message["type"] == "http.response.start":
                out = MutableHeaders(scope=message)
                out.setdefault("X-Content-Type-Options", "nosniff")
                out.setdefault("X-Frame-Options", "DENY")
                out.setdefault("Referrer-Policy", "no-referrer")
                if scope["path"].startswith("/api/"):
                    out.setdefault("Cache-Control", "no-store")
            await send(message)

        await self.app(scope, limited_receive, add_headers)


app.add_middleware(RequestGuard)
app.include_router(auth.router)
app.include_router(workspaces.router)
app.include_router(api.router)
app.include_router(voice_router)
app.include_router(ai_router, dependencies=[Depends(auth.require_admin)])


@app.exception_handler(ValidationError)
@app.exception_handler(RequestValidationError)
async def validation_error(request: Request, exc):
    language = error_locale(request)
    return JSONResponse(validation_info(exc, language), status_code=422, headers={"Content-Language": language})


@app.exception_handler(StarletteHTTPException)
async def http_error(request: Request, exc):
    language = error_locale(request)
    payload = error_info(exc, language)
    if request.url.path.startswith("/api/ai/") and not isinstance(exc, DomainError) and isinstance(exc.detail, str):
        from .ai.locale import translate as translate_ai
        payload = {"code": getattr(exc, "code", f"ai.http_{exc.status_code}"), "detail": translate_ai(exc.detail, language)}
    return JSONResponse(payload, status_code=exc.status_code, headers={**(exc.headers or {}), "Content-Language": language})


@app.get("/api/health")
def health():
    with engine.connect() as connection:
        connection.execute(text("SELECT 1 FROM accounts LIMIT 1"))
    return {"status": "ok"}


@app.get("/{path:path}", include_in_schema=False)
def spa(path: str):
    if path == "api" or path.startswith("api/"):
        raise HTTPException(404)
    default = Path(__file__).resolve().parents[2] / "frontend" / "dist"
    root = Path(os.environ.get("DAYWEAVE_STATIC_DIR", default)).resolve()
    target = (root / path).resolve()
    if target != root and root not in target.parents:
        raise HTTPException(404)
    if target.is_file():
        return FileResponse(target)
    if (root / "index.html").is_file() and "." not in Path(path).name:
        return FileResponse(root / "index.html", headers={"Cache-Control": "no-cache"})
    raise HTTPException(404)
