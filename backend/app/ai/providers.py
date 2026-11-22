import os
from urllib.parse import urlsplit

from fastapi import HTTPException
from pydantic import Field, SecretStr
from sqlalchemy.dialects.sqlite import insert

from . import oauth
from .adapters import DEFAULTS, Adapter, ProviderError, efforts
from .locale import preference, translate
from .models import AIProvider
from .secrets import seal, unseal
from .tools import Params


class ProviderPatch(Params):
    api_key: SecretStr | None = None
    base_url: str | None = Field(None, max_length=2048)
    name: str | None = Field(None, min_length=1, max_length=100)
    model: str | None = Field(None, max_length=180)
    reasoning: str | None = Field(None, max_length=40)
    enabled: bool | None = None


def provider(db, provider_id):
    if provider_id not in DEFAULTS:
        raise HTTPException(404, "服务商不存在。")
    row = db.get(AIProvider, provider_id)
    if row:
        return row
    name, base_url, model = DEFAULTS[provider_id]
    detail = (
        "需要符合官方开放源代码或已获批客户端资格，并由账号本人在本机完成授权。参阅 docs/AI_PROVIDERS.md。"
        if provider_id == "chatgpt"
        else ""
    )
    db.execute(
        insert(AIProvider)
        .values(
            id=provider_id, name=name, base_url=base_url, model=model, detail=detail
        )
        .on_conflict_do_nothing(index_elements=["id"])
    )
    return db.get(AIProvider, provider_id)


def public(row, lang="zh-CN"):
    return {
        "id": row.id,
        "name": translate(row.name, lang)
        if row.name == DEFAULTS[row.id][0]
        else row.name,
        "base_url": row.base_url,
        "model": row.model,
        "reasoning": row.reasoning,
        "enabled": row.enabled,
        "status": row.status,
        "detail": translate(row.detail, lang),
        "has_key": bool(row.secret),
        "models": [m["id"] for m in row.catalog],
        "catalog": row.catalog,
        "efforts": efforts(row.id, row.model, row.catalog),
    }


def configure(db, row, change):
    data = change.model_dump(exclude_unset=True, exclude_none=True)
    endpoint = data.pop("base_url", row.base_url).strip().rstrip("/")
    if endpoint != row.base_url:
        if row.id != "compatible":
            raise HTTPException(422, "官方服务商的接口地址固定。")
        parts = urlsplit(endpoint)
        allowed_http = os.getenv("DAYWEAVE_TRUSTED_HTTP_BASES", "").split(",")
        if (
            not parts.hostname
            or parts.username
            or parts.password
            or parts.query
            or parts.fragment
            or parts.scheme != "https"
            and not (parts.scheme == "http" and endpoint in allowed_http)
        ):
            raise HTTPException(
                422,
                "请输入 HTTPS 地址。局域网 HTTP 模型地址需由管理员列入 DAYWEAVE_TRUSTED_HTTP_BASES。",
            )
        row.base_url = endpoint
        row.secret, row.catalog, row.status, row.detail = None, [], "unconfigured", ""
    if "api_key" in data:
        if row.id == "chatgpt":
            raise HTTPException(422, "请通过官方授权连接 ChatGPT。")
        key = data.pop("api_key").get_secret_value().strip()
        if len(key) > 4096 or any(ord(ch) < 32 or ord(ch) > 126 for ch in key):
            raise HTTPException(422, "API Key 格式不正确。")
        row.secret = seal(key) if key else None
        row.catalog, row.status, row.detail = (
            [],
            "configured" if key else "unconfigured",
            "",
        )
    if (
        "model" in data
        and row.catalog
        and data["model"] not in {m["id"] for m in row.catalog}
    ):
        raise HTTPException(422, "模型不在此账号的模型目录中。")
    if data.get("reasoning", "auto") not in efforts(
        row.id, data.get("model", row.model), row.catalog
    ):
        raise HTTPException(422, "当前模型未声明支持这个推理档位。")
    for key, value in data.items():
        setattr(row, key, value)
    if row.reasoning not in efforts(row.id, row.model, row.catalog):
        row.reasoning = "auto"
    db.flush()
    return public(row, preference(db))


def adapter_for(db, row):
    if not row.enabled:
        raise ProviderError("此服务商已停用。")
    if not row.secret or not row.base_url:
        raise ProviderError(row.detail or "请先在设置中填写服务商凭据和接口地址。")
    credential = (
        oauth.access_token(db, row) if row.id == "chatgpt" else unseal(row.secret)
    )
    return Adapter(row.id, row.base_url, credential)


def test_provider(db, row):
    try:
        adapter = adapter_for(db, row)
        catalog = adapter.list_models()
        if not catalog:
            raise ProviderError("此账号未返回可用模型。")
        row.catalog = catalog
        if not any(m["id"] == row.model for m in catalog):
            row.model, row.reasoning = catalog[0]["id"], "auto"
        row.status, row.detail = "connected", "已通过凭据验证并取得当前账号的模型目录。"
    except ProviderError as exc:
        row.status, row.detail = ("error" if row.secret else "unconfigured"), str(exc)
    db.flush()
    return public(row, preference(db))
