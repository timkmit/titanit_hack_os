from __future__ import annotations

import json
from collections.abc import AsyncIterator

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse, StreamingResponse

from app.services.gigachat import GigaChatService, adapt_gigachat_response

router = APIRouter(prefix="/api/providers/gigachat/v1", tags=["gigachat"])


def _service(request: Request) -> GigaChatService:
    return request.app.state.gigachat_service


async def _single_response_sse(payload: dict, service: GigaChatService) -> AsyncIterator[bytes]:
    try:
        non_stream_payload = dict(payload)
        non_stream_payload["stream"] = False
        response = await service.chat_completions(non_stream_payload)
        data = adapt_gigachat_response(response.json())
        model = str(data.get("model", payload.get("model", "GigaChat")))
        choice = (data.get("choices") or [{}])[0]
        message = choice.get("message") or {}
        delta: dict[str, object] = {"role": "assistant"}
        content = message.get("content", "")
        if content:
            delta["content"] = content
        tool_calls = message.get("tool_calls")
        if isinstance(tool_calls, list) and tool_calls:
            delta["tool_calls"] = tool_calls

        chunk = {
            "id": data.get("id", "gigachat-proxy"),
            "object": "chat.completion.chunk",
            "created": data.get("created", 0),
            "model": model,
            "choices": [
                {
                    "index": 0,
                    "delta": delta,
                    "finish_reason": choice.get("finish_reason", "stop"),
                }
            ],
        }
        yield f"data: {json.dumps(chunk, ensure_ascii=False)}\n\n".encode("utf-8")
        yield b"data: [DONE]\n\n"
    except Exception as error:  # pragma: no cover - streaming compatibility path
        error_chunk = {
            "error": {
                "message": str(error),
                "type": "gigachat_proxy_error",
            }
        }
        yield f"data: {json.dumps(error_chunk, ensure_ascii=False)}\n\n".encode("utf-8")
        yield b"data: [DONE]\n\n"


@router.get("/models")
async def list_models(request: Request) -> JSONResponse:
    try:
        payload = await _service(request).models()
    except Exception as error:  # pragma: no cover - passthrough for runtime diagnostics
        raise HTTPException(status_code=502, detail=str(error)) from error
    return JSONResponse(payload)


@router.post("/chat/completions")
async def chat_completions(request: Request):
    payload = await request.json()
    service = _service(request)
    try:
        if payload.get("stream") is True:
            return StreamingResponse(
                _single_response_sse(payload, service),
                media_type="text/event-stream",
            )
        response = await service.chat_completions(payload)
    except Exception as error:  # pragma: no cover - passthrough for runtime diagnostics
        raise HTTPException(status_code=502, detail=str(error)) from error
    return JSONResponse(adapt_gigachat_response(response.json()))
