from __future__ import annotations

import asyncio
import json
import time
import uuid
from collections.abc import AsyncIterator

import httpx

from app.core.settings import Settings


_OPENAI_ALLOWED_KEYS = {
    "model",
    "messages",
    "temperature",
    "top_p",
    "max_tokens",
    "repetition_penalty",
    "update_interval",
    "profanity_check",
    "stream",
    "functions",
    "function_call",
}


def _normalize_function_result(content: object) -> str:
    text = _stringify_content(content).strip()
    if not text:
        return "{}"
    try:
        parsed = json.loads(text)
    except json.JSONDecodeError:
        compact_text = text
        if "[image data removed - already processed by model]" not in compact_text:
            compact_text = compact_text.replace("data:image/", "[image data removed] data:image/")
        return json.dumps({"result": compact_text}, ensure_ascii=False)
    return json.dumps(parsed, ensure_ascii=False)


def _stringify_content(content: object) -> str:
    if content is None:
        return ""
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts: list[str] = []
        for item in content:
            if isinstance(item, str):
                parts.append(item)
            elif isinstance(item, dict):
                if item.get("type") == "text" and isinstance(item.get("text"), str):
                    parts.append(item["text"])
                elif isinstance(item.get("content"), str):
                    parts.append(item["content"])
        return "\n".join(part for part in parts if part).strip()
    if isinstance(content, dict):
        return json.dumps(content, ensure_ascii=False)
    return str(content)


def _normalize_schema(value: object) -> object:
    if isinstance(value, list):
        return [_normalize_schema(item) for item in value]
    if not isinstance(value, dict):
        return value

    normalized: dict[str, object] = {}
    for key, item in value.items():
        if key in {"additionalProperties", "strict"}:
            continue
        if key == "type" and isinstance(item, list):
            scalar_types = [part for part in item if isinstance(part, str) and part != "null"]
            normalized[key] = scalar_types[0] if scalar_types else "string"
            continue
        normalized[key] = _normalize_schema(item)

    properties = normalized.get("properties")
    if isinstance(properties, dict):
        normalized["properties"] = {
            str(prop_name): _normalize_schema(prop_schema)
            for prop_name, prop_schema in properties.items()
        }
    elif normalized.get("type") == "object":
        normalized["properties"] = {}

    items = normalized.get("items")
    if items is not None:
        normalized["items"] = _normalize_schema(items)
    elif normalized.get("type") == "array":
        normalized["items"] = {"type": "string"}

    required = normalized.get("required")
    properties = normalized.get("properties")
    if isinstance(required, list):
        if isinstance(properties, dict):
            normalized["required"] = [
                item for item in required if isinstance(item, str) and item in properties
            ]
        else:
            normalized.pop("required", None)

    any_of = normalized.pop("anyOf", None)
    one_of = normalized.pop("oneOf", None)
    for variants in (any_of, one_of):
        if isinstance(variants, list) and variants:
            first_variant = next(
                (variant for variant in variants if isinstance(variant, dict)),
                variants[0],
            )
            merged = _normalize_schema(first_variant)
            if isinstance(merged, dict):
                normalized.update(merged)

    return normalized


def _parse_tool_call_id(tool_call_id: str) -> tuple[str | None, str | None]:
    if not tool_call_id.startswith("gigachat::"):
        return None, None
    parts = tool_call_id.split("::", 2)
    if len(parts) != 3:
        return None, None
    _, functions_state_id, tool_name = parts
    return functions_state_id or None, tool_name or None


def _encode_tool_call_id(functions_state_id: str | None, tool_name: str) -> str:
    if functions_state_id:
        return f"gigachat::{functions_state_id}::{tool_name}"
    return f"gigachat::local::{tool_name}"


def adapt_openai_request(payload: dict) -> dict:
    tool_name_by_id: dict[str, str] = {}
    functions_state_id_by_id: dict[str, str] = {}
    messages: list[dict] = []

    for message in payload.get("messages", []):
        if not isinstance(message, dict):
            continue
        role = str(message.get("role", "user"))

        if role == "assistant" and isinstance(message.get("tool_calls"), list):
            tool_calls = [item for item in message["tool_calls"] if isinstance(item, dict)]
            if not tool_calls:
                continue
            tool_call = tool_calls[0]
            function_payload = tool_call.get("function")
            if not isinstance(function_payload, dict):
                continue
            function_name = str(function_payload.get("name", "")).strip()
            if not function_name:
                continue
            tool_call_id = str(tool_call.get("id", "")).strip()
            functions_state_id, encoded_name = _parse_tool_call_id(tool_call_id)
            if not functions_state_id and tool_call_id:
                functions_state_id = functions_state_id_by_id.get(tool_call_id)
            if encoded_name and not function_name:
                function_name = encoded_name
            if tool_call_id:
                tool_name_by_id[tool_call_id] = function_name
                if functions_state_id:
                    functions_state_id_by_id[tool_call_id] = functions_state_id

            arguments = function_payload.get("arguments", {})
            if isinstance(arguments, str):
                try:
                    arguments = json.loads(arguments)
                except json.JSONDecodeError:
                    arguments = {"raw": arguments}

            adapted_message = {
                "role": "assistant",
                "content": _stringify_content(message.get("content")),
                "function_call": {
                    "name": function_name,
                    "arguments": arguments,
                },
            }
            if functions_state_id:
                adapted_message["functions_state_id"] = functions_state_id
            messages.append(adapted_message)
            continue

        if role == "tool":
            tool_call_id = str(message.get("tool_call_id", "")).strip()
            functions_state_id, tool_name = _parse_tool_call_id(tool_call_id)
            tool_name = tool_name or tool_name_by_id.get(tool_call_id)
            if not tool_name:
                continue
            adapted_message = {
                "role": "function",
                "name": tool_name,
                "content": _normalize_function_result(message.get("content")),
            }
            messages.append(adapted_message)
            if functions_state_id:
                functions_state_id_by_id[tool_call_id] = functions_state_id
            continue

        adapted_message: dict[str, object] = {
            "role": role,
            "content": _stringify_content(message.get("content")),
        }
        if role == "function" and isinstance(message.get("name"), str):
            adapted_message["name"] = message["name"]
        messages.append(adapted_message)

    adapted_payload = {key: value for key, value in payload.items() if key in _OPENAI_ALLOWED_KEYS}
    adapted_payload["messages"] = messages

    tools = payload.get("tools")
    if isinstance(tools, list):
        functions: list[dict] = []
        for tool in tools:
            if not isinstance(tool, dict) or tool.get("type") != "function":
                continue
            function_payload = tool.get("function")
            if isinstance(function_payload, dict) and isinstance(function_payload.get("name"), str):
                normalized_function = dict(function_payload)
                parameters = normalized_function.get("parameters")
                if isinstance(parameters, dict):
                    normalized_function["parameters"] = _normalize_schema(parameters)
                functions.append(normalized_function)
        if functions:
            adapted_payload["functions"] = functions

    tool_choice = payload.get("tool_choice")
    if tool_choice == "auto":
        adapted_payload["function_call"] = "auto"
    elif tool_choice == "none":
        adapted_payload.pop("function_call", None)
        adapted_payload.pop("functions", None)
    elif isinstance(tool_choice, dict):
        function_choice = tool_choice.get("function")
        if isinstance(function_choice, dict) and isinstance(function_choice.get("name"), str):
            adapted_payload["function_call"] = {"name": function_choice["name"]}

    return adapted_payload


def adapt_gigachat_response(payload: dict) -> dict:
    adapted = dict(payload)
    choices = adapted.get("choices")
    if not isinstance(choices, list):
        return adapted

    for choice in choices:
        if not isinstance(choice, dict):
            continue
        message = choice.get("message")
        if not isinstance(message, dict):
            continue
        function_call = message.pop("function_call", None)
        if not isinstance(function_call, dict):
            continue

        function_name = str(function_call.get("name", "")).strip()
        if not function_name:
            continue
        arguments = function_call.get("arguments", {})
        if not isinstance(arguments, str):
            arguments = json.dumps(arguments, ensure_ascii=False)

        functions_state_id = message.get("functions_state_id")
        tool_call_id = _encode_tool_call_id(
            str(functions_state_id) if isinstance(functions_state_id, str) else None,
            function_name,
        )
        message["tool_calls"] = [
            {
                "id": tool_call_id,
                "type": "function",
                "function": {
                    "name": function_name,
                    "arguments": arguments,
                },
            }
        ]
        if choice.get("finish_reason") == "function_call":
            choice["finish_reason"] = "tool_calls"

    return adapted


class GigaChatService:
    def __init__(self, settings: Settings, client: httpx.AsyncClient) -> None:
        self._settings = settings
        self._client = client
        self._token: str | None = None
        self._token_expires_at: float = 0.0
        self._lock = asyncio.Lock()

    async def _request(self, method: str, url: str, **kwargs) -> httpx.Response:
        async with httpx.AsyncClient(verify=self._settings.gigachat_verify_ssl) as client:
            response = await client.request(method, url, **kwargs)
        return response

    async def get_access_token(self) -> str:
        async with self._lock:
            now = time.time()
            if self._token and now < self._token_expires_at - 60:
                return self._token

            headers = {
                "Content-Type": "application/x-www-form-urlencoded",
                "Accept": "application/json",
                "RqUID": str(uuid.uuid4()),
                "Authorization": f"Basic {self._settings.gigachat_auth_key}",
            }
            response = await self._request(
                "POST",
                self._settings.gigachat_oauth_url,
                content=f"scope={self._settings.gigachat_scope}",
                headers=headers,
                timeout=30.0,
            )
            response.raise_for_status()
            payload = response.json()
            access_token = str(payload["access_token"])
            expires_at_ms = payload.get("expires_at")
            if isinstance(expires_at_ms, int):
                self._token_expires_at = expires_at_ms / 1000.0
            else:
                self._token_expires_at = time.time() + 29 * 60
            self._token = access_token
            return access_token

    async def models(self) -> dict:
        token = await self.get_access_token()
        response = await self._request(
            "GET",
            f"{self._settings.gigachat_base_url}/models",
            headers={"Authorization": f"Bearer {token}"},
            timeout=60.0,
        )
        response.raise_for_status()
        return response.json()

    async def chat_completions(self, payload: dict) -> httpx.Response:
        token = await self.get_access_token()
        adapted_payload = adapt_openai_request(payload)
        response = await self._request(
            "POST",
            f"{self._settings.gigachat_base_url}/chat/completions",
            headers={"Authorization": f"Bearer {token}"},
            json=adapted_payload,
            timeout=120.0,
        )
        try:
            response.raise_for_status()
        except httpx.HTTPStatusError as error:
            detail = response.text.strip()
            raise httpx.HTTPStatusError(
                f"{error}. Upstream body: {detail}",
                request=error.request,
                response=error.response,
            ) from error
        return response

    async def stream_chat_completions(self, payload: dict) -> AsyncIterator[bytes]:
        token = await self.get_access_token()
        async with httpx.AsyncClient(verify=self._settings.gigachat_verify_ssl) as client:
            async with client.stream(
            "POST",
            f"{self._settings.gigachat_base_url}/chat/completions",
            headers={"Authorization": f"Bearer {token}"},
            json=payload,
            timeout=None,
            ) as response:
                response.raise_for_status()
                async for chunk in response.aiter_bytes():
                    if chunk:
                        yield chunk
