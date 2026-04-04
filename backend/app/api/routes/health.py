import httpx
from fastapi import APIRouter, Request, Response

from app.core.settings import Settings, get_settings
from app.services.status import StatusService

router = APIRouter(tags=["health"])


@router.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@router.get("/ready")
async def ready(request: Request, response: Response) -> dict:
    settings: Settings = get_settings()
    client: httpx.AsyncClient = request.app.state.http_client
    payload = await StatusService.ready(client, settings)
    if payload.status != "ready":
        response.status_code = 503
    return payload.model_dump()
