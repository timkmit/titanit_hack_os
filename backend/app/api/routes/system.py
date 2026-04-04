from fastapi import APIRouter

from app.core.settings import Settings, get_settings
from app.services.runtime import runtime_summary

router = APIRouter(prefix="/api", tags=["system"])


@router.get("/info")
async def info() -> dict:
    settings: Settings = get_settings()
    return runtime_summary(settings)
