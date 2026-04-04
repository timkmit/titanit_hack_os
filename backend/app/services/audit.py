from __future__ import annotations

import json
import zipfile
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from app.core.settings import Settings


def _to_iso(timestamp_ms: int | None) -> str | None:
    if timestamp_ms is None:
        return None
    return datetime.fromtimestamp(timestamp_ms / 1000, tz=UTC).isoformat()


def _safe_read_json(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {}
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return {}


def _summarize_message_content(content: list[dict[str, Any]]) -> tuple[str | None, list[dict[str, Any]]]:
    text_chunks: list[str] = []
    tool_calls: list[dict[str, Any]] = []
    for block in content:
        block_type = block.get("type")
        if block_type == "text":
            text_chunks.append(block.get("text", ""))
        elif block_type == "toolCall":
            tool_calls.append(
                {
                    "id": block.get("id"),
                    "name": block.get("name"),
                    "arguments": block.get("arguments", {}),
                }
            )
    summary = "\n".join(chunk.strip() for chunk in text_chunks if chunk.strip()) or None
    return summary, tool_calls


class AuditService:
    @staticmethod
    def list_sessions(settings: Settings) -> list[dict[str, Any]]:
        sessions_path = settings.openclaw_sessions_path / "sessions.json"
        payload = _safe_read_json(sessions_path)
        sessions: dict[str, dict[str, Any]] = {}
        for key, meta in payload.items():
            session_id = meta.get("sessionId")
            if not session_id:
                continue
            sessions[session_id] = {
                "sessionKey": key,
                "sessionId": session_id,
                "status": meta.get("status"),
                "updatedAt": _to_iso(meta.get("updatedAt")),
                "startedAt": _to_iso(meta.get("startedAt")),
                "endedAt": _to_iso(meta.get("endedAt")),
                "runtimeMs": meta.get("runtimeMs"),
                "model": meta.get("model"),
                "provider": meta.get("modelProvider"),
                "origin": meta.get("origin", {}),
                "lastChannel": meta.get("lastChannel"),
                "sessionFile": meta.get("sessionFile"),
            }

        for transcript_path in settings.openclaw_sessions_path.glob("*.jsonl"):
            session_id = transcript_path.stem
            if session_id in sessions:
                continue
            try:
                first_line = transcript_path.read_text(encoding="utf-8").splitlines()[0]
                first_event = json.loads(first_line) if first_line else {}
            except (IndexError, json.JSONDecodeError, UnicodeDecodeError):
                first_event = {}
            stat = transcript_path.stat()
            sessions[session_id] = {
                "sessionKey": None,
                "sessionId": session_id,
                "status": None,
                "updatedAt": datetime.fromtimestamp(stat.st_mtime, tz=UTC).isoformat(),
                "startedAt": first_event.get("timestamp"),
                "endedAt": None,
                "runtimeMs": None,
                "model": None,
                "provider": None,
                "origin": {},
                "lastChannel": None,
                "sessionFile": str(transcript_path),
            }

        items = list(sessions.values())
        items.sort(key=lambda item: item.get("updatedAt") or "", reverse=True)
        return items

    @staticmethod
    def get_session(settings: Settings, session_id: str) -> dict[str, Any]:
        transcript_path = settings.openclaw_sessions_path / f"{session_id}.jsonl"
        if not transcript_path.exists():
            raise FileNotFoundError(session_id)

        events: list[dict[str, Any]] = []
        for raw_line in transcript_path.read_text(encoding="utf-8").splitlines():
            if not raw_line.strip():
                continue
            try:
                item = json.loads(raw_line)
            except json.JSONDecodeError:
                continue

            event_type = item.get("type")
            normalized: dict[str, Any] = {
                "type": event_type,
                "timestamp": item.get("timestamp"),
            }

            if event_type == "message":
                message = item.get("message", {})
                summary, tool_calls = _summarize_message_content(message.get("content", []))
                normalized.update(
                    {
                        "role": message.get("role"),
                        "summary": summary,
                        "toolCalls": tool_calls,
                        "stopReason": message.get("stopReason"),
                        "provider": message.get("provider"),
                        "model": message.get("model"),
                        "usage": message.get("usage"),
                    }
                )
            elif event_type == "custom":
                data = item.get("data", {})
                normalized.update(
                    {
                        "customType": item.get("customType"),
                        "summary": data.get("error") or data.get("decision") or data.get("runId"),
                        "data": data,
                    }
                )
            elif event_type == "compaction":
                normalized["summary"] = item.get("summary")
            else:
                normalized["summary"] = None

            events.append(normalized)

        return {
            "sessionId": session_id,
            "path": str(transcript_path),
            "events": events,
        }

    @staticmethod
    def list_exports(settings: Settings) -> list[dict[str, Any]]:
        exports = []
        for archive in sorted(settings.audit_export_dir.glob("*.zip"), reverse=True):
            stat = archive.stat()
            exports.append(
                {
                    "name": archive.name,
                    "path": str(archive),
                    "sizeBytes": stat.st_size,
                    "createdAt": datetime.fromtimestamp(stat.st_mtime, tz=UTC).isoformat(),
                }
            )
        return exports

    @staticmethod
    def create_export(settings: Settings) -> dict[str, Any]:
        timestamp = datetime.now(tz=UTC).strftime("%Y%m%dT%H%M%SZ")
        archive_path = settings.audit_export_dir / f"openclaw-audit-{timestamp}.zip"

        include_paths = [
            settings.openclaw_config_path,
            settings.openclaw_host_config_path,
            settings.workspace_path,
            settings.openclaw_sessions_path,
        ]

        with zipfile.ZipFile(archive_path, mode="w", compression=zipfile.ZIP_DEFLATED) as bundle:
            for include_path in include_paths:
                if not include_path.exists():
                    continue
                if include_path.is_file():
                    bundle.write(include_path, arcname=include_path.name)
                    continue
                for file_path in include_path.rglob("*"):
                    if file_path.is_dir():
                        continue
                    bundle.write(file_path, arcname=file_path.relative_to(settings.runtime_root))

        return {
            "name": archive_path.name,
            "path": str(archive_path),
            "createdAt": datetime.now(tz=UTC).isoformat(),
        }
