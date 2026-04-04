from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from app.core.settings import Settings


def _read_json(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {}
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return {}


def load_gateway_config(settings: Settings) -> dict[str, Any]:
    return _read_json(settings.openclaw_config_path)


def runtime_summary(settings: Settings) -> dict[str, Any]:
    config = load_gateway_config(settings)
    browser = config.get("browser", {})
    agents = config.get("agents", {}).get("defaults", {})
    model = agents.get("model", {}).get("primary", "unknown")
    tool_cfg = config.get("tools", {})
    return {
        "project": {
            "name": settings.project_name,
            "version": settings.project_version,
            "description": settings.project_description,
        },
        "urls": {
            "controlUi": settings.openclaw_public_url,
            "gatewayWs": settings.gateway_ws_url,
            "apiDocs": f"http://localhost:{settings.api_port}/docs",
        },
        "agent": {
            "model": model,
            "timeoutSeconds": agents.get("timeoutSeconds"),
            "workspace": agents.get("workspace"),
        },
        "browser": {
            "enabled": browser.get("enabled", True),
            "defaultProfile": browser.get("defaultProfile", "openclaw"),
            "headless": browser.get("headless", False),
            "noSandbox": browser.get("noSandbox", False),
            "ssrfPolicy": browser.get("ssrfPolicy", {}),
        },
        "tools": {
            "profile": tool_cfg.get("profile", "full"),
            "allow": tool_cfg.get("allow", []),
            "deny": tool_cfg.get("deny", []),
            "web": tool_cfg.get("web", {}),
        },
        "examples": list(settings.examples),
    }
