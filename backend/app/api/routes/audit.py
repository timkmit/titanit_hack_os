from pathlib import Path

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse

from app.core.settings import Settings, get_settings
from app.services.audit import AuditService

router = APIRouter(prefix="/api/audit", tags=["audit"])


@router.get("/sessions")
async def list_sessions() -> dict[str, list[dict]]:
    settings: Settings = get_settings()
    return {"items": AuditService.list_sessions(settings)}


@router.get("/sessions/{session_id}")
async def get_session(session_id: str) -> dict:
    settings: Settings = get_settings()
    try:
        return AuditService.get_session(settings, session_id)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=f"Session not found: {exc.args[0]}") from exc


@router.get("/exports")
async def list_exports() -> dict[str, list[dict]]:
    settings: Settings = get_settings()
    return {"items": AuditService.list_exports(settings)}


@router.post("/exports", status_code=201)
async def create_export() -> dict:
    settings: Settings = get_settings()
    return AuditService.create_export(settings)


@router.get("/exports/{archive_name}")
async def download_export(archive_name: str) -> FileResponse:
    settings: Settings = get_settings()
    archive_path = settings.audit_export_dir / archive_name
    if not archive_path.exists():
        raise HTTPException(status_code=404, detail="Archive not found")
    return FileResponse(path=Path(archive_path), filename=archive_name, media_type="application/zip")
