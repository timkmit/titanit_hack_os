from typing import Literal

import httpx
from pydantic import BaseModel

from app.core.settings import Settings
from app.services.gigachat import GigaChatService


class DependencyStatus(BaseModel):
    name: str
    ok: bool
    detail: str | None = None


class ReadyPayload(BaseModel):
    status: Literal["ready", "not_ready"]
    checks: list[DependencyStatus]


class StatusService:
    @staticmethod
    async def probe_openclaw(client: httpx.AsyncClient, settings: Settings) -> DependencyStatus:
        url = f"{settings.openclaw_base_url.rstrip('/')}/healthz"
        try:
            response = await client.get(url, timeout=httpx.Timeout(3.0))
            ok = response.is_success
            return DependencyStatus(
                name="openclaw",
                ok=ok,
                detail=str(response.status_code),
            )
        except Exception as exc:
            return DependencyStatus(name="openclaw", ok=False, detail=str(exc))

    @staticmethod
    async def probe_ollama(client: httpx.AsyncClient, settings: Settings) -> DependencyStatus:
        url = f"{settings.ollama_base_url.rstrip('/')}/api/tags"
        try:
            response = await client.get(url, timeout=httpx.Timeout(3.0))
            ok = response.is_success
            return DependencyStatus(
                name="ollama",
                ok=ok,
                detail=str(response.status_code),
            )
        except Exception as exc:
            return DependencyStatus(name="ollama", ok=False, detail=str(exc))

    @staticmethod
    async def probe_gigachat(client: httpx.AsyncClient, settings: Settings) -> DependencyStatus:
        del client
        ok = bool(settings.gigachat_auth_key)
        return DependencyStatus(
            name="gigachat",
            ok=ok,
            detail="configured" if ok else "missing auth key",
        )

    @classmethod
    async def ready(cls, client: httpx.AsyncClient, settings: Settings) -> ReadyPayload:
        checks = [await cls.probe_openclaw(client, settings)]
        if settings.gigachat_auth_key:
            checks.append(await cls.probe_gigachat(client, settings))
        else:
            checks.append(await cls.probe_ollama(client, settings))
        status: Literal["ready", "not_ready"] = (
            "ready" if all(c.ok for c in checks) else "not_ready"
        )
        return ReadyPayload(status=status, checks=checks)
