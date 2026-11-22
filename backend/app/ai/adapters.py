"""Translate domain messages and tools to the provider's streaming protocol."""

import json
import re
import time
from collections.abc import Iterator
from dataclasses import dataclass, field

import httpx

DEFAULTS = {
    "deepseek": ("DeepSeek", "https://api.deepseek.com", "deepseek-flash"),
    "openai": ("OpenAI API", "https://api.openai.com/v1", "gpt-5.4"),
    "compatible": ("OpenAI 兼容接口", "", ""),
    "chatgpt": ("ChatGPT", "https://api.openai.com/v1", ""),
}


class ProviderError(Exception):
    """Diagnostics safe for browser display and persistent storage."""


def efforts(provider, model, catalog=()):
    item = next((m for m in catalog if m["id"] == model), {})
    if provider == "chatgpt":
        return ["auto", *[v for v in item.get("efforts", []) if v != "auto"]]
    if provider == "deepseek" and model in {
        "deepseek-flash",
        "deepseek-v4-pro",
        "deepseek-v4-flash",
    }:
        return ["auto", "none", "low", "high", "max"]
    if provider == "openai" and re.fullmatch(
        r"gpt-5\.4(?:-\d{4}-\d\d-\d\d)?", model or ""
    ):
        return ["auto", "none", "low", "medium", "high", "xhigh"]
    return ["auto"]


def safe_error(response):
    status = response.status_code
    try:
        info = response.json().get("error")
        code = info.get("code") if isinstance(info, dict) else None
    except (ValueError, AttributeError):
        code = None
    hints = {
        400: "请求参数或模型能力不匹配",
        401: "凭据已失效或无效",
        402: "余额不足",
        403: "账号、工作区或地区未获授权",
        404: "接口或模型不存在",
        429: "服务商限流或额度不足",
        503: "服务暂时不可用",
    }
    detail = hints.get(status, "服务商拒绝了请求")
    # Providers can echo a supplied key in message fields. Only expose machine codes.
    suffix = (
        f" ({code})"
        if isinstance(code, str) and re.fullmatch("[a-z][a-z_]{1,80}", code)
        else ""
    )
    return ProviderError(f"HTTP {status} · {detail}{suffix}")


@dataclass
class Call:
    id: str
    name: str
    arguments: str


@dataclass
class Round:
    text: str = ""
    calls: list[Call] = field(default_factory=list)
    wire: list[dict] = field(default_factory=list)


class Adapter:
    def __init__(self, provider, base_url, token):
        self.provider = provider
        self.base_url = base_url.rstrip("/")
        self.key = token
        self.responses = provider in {"openai", "chatgpt"}

    def client(self):
        return httpx.Client(
            headers={"Authorization": f"Bearer {self.key}"},
            timeout=httpx.Timeout(60.0, connect=8.0),
            follow_redirects=False,
        )

    def list_models(self):
        try:
            with self.client() as client:
                for attempt in range(2):
                    response = client.get(self.base_url + "/models")
                    if response.status_code not in (502, 503, 504) or attempt:
                        break
                    time.sleep(0.35)
                if not response.is_success:
                    raise safe_error(response)
                payload = response.json()
                if self.provider == "chatgpt":
                    rows = []
                    for item in payload["models"]:
                        if item.get("visibility") != "list" or not isinstance(
                            item.get("slug"), str
                        ):
                            continue
                        levels = item.get("supported_reasoning_levels", [])
                        values = [
                            v.get("effort") if isinstance(v, dict) else v
                            for v in levels
                        ]
                        rows.append(
                            {
                                "id": item["slug"],
                                "name": item.get("display_name") or item["slug"],
                                "efforts": [v for v in values if isinstance(v, str)],
                            }
                        )
                    return rows
                return [
                    {"id": m["id"], "name": m["id"]}
                    for m in payload["data"]
                    if isinstance(m.get("id"), str)
                ]
        except httpx.RequestError:
            raise ProviderError("无法连接服务商，请检查地址与网络。") from None
        except (KeyError, TypeError, ValueError, AttributeError):
            raise ProviderError("服务商返回了无法识别的模型目录。") from None

    def _events(self, path, body):
        try:
            with self.client() as client:
                for attempt in range(2):
                    with client.stream("POST", self.base_url + path, json=body) as resp:
                        if not resp.is_success:
                            resp.read()
                            if resp.status_code in (502, 503, 504) and not attempt:
                                time.sleep(0.35)
                                continue
                            raise safe_error(resp)
                        for line in resp.iter_lines():
                            if line.startswith("data:"):
                                segment = line[5:].strip()
                                if segment and segment != "[DONE]":
                                    yield json.loads(segment)
                        return
        except httpx.RequestError:
            raise ProviderError(
                "模型连接中断。已保存的操作可以在历史记录中查看。"
            ) from None
        except (ValueError, IndexError, KeyError, TypeError):
            raise ProviderError("服务商返回了无法识别的数据流。") from None

    def stream(
        self, instructions, history, functions, model, reasoning, result: Round
    ) -> Iterator[str]:
        if self.responses:
            yield from self._responses(
                instructions, history, functions, model, reasoning, result
            )
        else:
            yield from self._chat(
                instructions, history, functions, model, reasoning, result
            )

    def _chat(self, instructions, history, functions, model, reasoning, result):
        payload = {
            "model": model,
            "stream": True,
            "messages": [{"role": "system", "content": instructions}, *history],
        }
        if functions:
            payload["tools"] = [
                {"type": "function", "function": fn} for fn in functions
            ]
        if self.provider == "deepseek" and reasoning != "auto":
            payload["thinking"] = {
                "type": "disabled" if reasoning == "none" else "enabled"
            }
            if reasoning != "none":
                payload["reasoning_effort"] = reasoning
        calls, reasoning_trace, finished = {}, "", False
        for event in self._events("/chat/completions", payload):
            if event.get("error"):
                raise ProviderError("服务商报告生成失败。")
            for choice in event.get("choices", []):
                if choice.get("index", 0) != 0:
                    continue
                delta = choice.get("delta", {})
                chunk = delta.get("content") or ""
                if chunk:
                    result.text += chunk
                    yield chunk
                reasoning_trace += delta.get("reasoning_content") or ""
                for tool in delta.get("tool_calls", []):
                    call = calls.setdefault(
                        tool["index"], {"id": "", "name": "", "arguments": ""}
                    )
                    call["id"] += tool.get("id") or ""
                    for key in ("name", "arguments"):
                        call[key] += tool.get("function", {}).get(key) or ""
                if choice.get("finish_reason") in ("stop", "tool_calls"):
                    finished = True
        if not finished:
            raise ProviderError("服务商未完整结束此次生成，请重试。")
        result.calls = [Call(**c) for _, c in sorted(calls.items())]
        msg = {"role": "assistant", "content": result.text or None}
        if result.calls:
            msg["tool_calls"] = [
                {
                    "id": c.id,
                    "type": "function",
                    "function": {"name": c.name, "arguments": c.arguments},
                }
                for c in result.calls
            ]
            if self.provider == "deepseek":
                msg["reasoning_content"] = reasoning_trace
        result.wire.append(msg)

    def _responses(self, instructions, history, functions, model, reasoning, result):
        payload = {
            "model": model,
            "instructions": instructions,
            "input": history,
            "store": False,
            "stream": True,
            "include": ["reasoning.encrypted_content"],
        }
        if functions:
            definitions = [
                {"type": "function", **f, "strict": False} for f in functions
            ]
            payload["tools"] = (
                [
                    {
                        "type": "namespace",
                        "name": "dayweave",
                        "description": "Manage the user's local workspace",
                        "tools": definitions,
                    }
                ]
                if self.provider == "chatgpt"
                else definitions
            )
        if reasoning != "auto":
            payload["reasoning"] = {"effort": reasoning}
        complete = False
        for event in self._events("/responses", payload):
            kind = event.get("type")
            if kind == "response.output_text.delta":
                result.text += event["delta"]
                yield event["delta"]
            elif kind in ("response.failed", "response.incomplete", "error"):
                error = event.get("response", {}).get("error") or {}
                code = error.get("code")
                suffix = (
                    code
                    if isinstance(code, str) and re.fullmatch("[a-z_]{1,80}", code)
                    else "请检查账户与模型配置"
                )
                raise ProviderError(f"模型未能完成请求（{suffix}）。")
            elif kind == "response.completed":
                complete = True
                for item in event["response"].get("output", []):
                    if item["type"] == "function_call":
                        result.calls.append(
                            Call(item["call_id"], item["name"], item["arguments"])
                        )
                    if item["type"] in ("reasoning", "function_call", "message"):
                        # Stateless continuation must replay the output items, including encrypted reasoning.
                        result.wire.append(item)
        if not complete:
            raise ProviderError("未收到模型的完成事件，请检查网络后重试。")

    def output(self, call, data):
        content = json.dumps(data, ensure_ascii=False, default=str)
        if self.responses:
            return {
                "type": "function_call_output",
                "call_id": call.id,
                "output": content,
            }
        return {"role": "tool", "tool_call_id": call.id, "content": content}
