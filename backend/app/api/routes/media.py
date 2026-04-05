from pathlib import Path

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse

from app.core.settings import Settings, get_settings

router = APIRouter(prefix="/api/media", tags=["media"])


def _browser_media_dir(settings: Settings) -> Path:
    media_dir = settings.openclaw_browser_media_path.resolve()
    if not media_dir.exists():
        raise HTTPException(status_code=404, detail="Browser media directory not found")
    return media_dir


@router.get("/browser")
async def list_browser_media() -> dict[str, list[dict[str, str | int]]]:
    settings: Settings = get_settings()
    media_dir = _browser_media_dir(settings)
    items: list[dict[str, str | int]] = []
    for file_path in sorted(media_dir.glob("*.png"), key=lambda path: path.stat().st_mtime, reverse=True):
        stat = file_path.stat()
        items.append(
            {
                "name": file_path.name,
                "size": stat.st_size,
                "mtimeMs": int(stat.st_mtime * 1000),
                "url": f"/api/media/browser/{file_path.name}",
            }
        )
    return {"items": items}


@router.get("/browser/{file_name}")
async def get_browser_media(file_name: str) -> FileResponse:
    settings: Settings = get_settings()
    media_dir = _browser_media_dir(settings)
    if "/" in file_name or "\\" in file_name or not file_name.lower().endswith(".png"):
        raise HTTPException(status_code=400, detail="Invalid file name")
    file_path = (media_dir / file_name).resolve()
    if file_path.parent != media_dir or not file_path.exists():
        raise HTTPException(status_code=404, detail="Browser media file not found")
    return FileResponse(path=file_path, filename=file_name, media_type="image/png")
