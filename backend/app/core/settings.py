from functools import lru_cache
from pathlib import Path

from pydantic import computed_field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    project_name: str = "Titanit Browser Agent"
    project_version: str = "0.1.0"
    project_description: str = "Universal browser-control assistant powered by OpenClaw."

    openclaw_base_url: str = "http://openclaw-gateway:18789"
    ollama_base_url: str = "http://host.docker.internal:11434"
    openclaw_public_url: str = "http://localhost:18789"
    frontend_origin: str = "http://localhost:3000,http://127.0.0.1:3000"
    api_host: str = "0.0.0.0"
    api_port: int = 8000
    gigachat_base_url: str = "https://gigachat.devices.sberbank.ru/api/v1"
    gigachat_oauth_url: str = "https://ngw.devices.sberbank.ru:9443/api/v2/oauth"
    gigachat_scope: str = "GIGACHAT_API_PERS"
    gigachat_auth_key: str = ""
    gigachat_client_id: str = ""
    gigachat_model: str = "GigaChat"
    gigachat_verify_ssl: bool = True

    runtime_root: Path = Path("/app/runtime")
    openclaw_config_path: Path = Path("/app/runtime/openclaw/openclaw.json")
    openclaw_host_config_path: Path = Path("/app/runtime/openclaw/openclaw.host.json")
    openclaw_sessions_path: Path = Path("/app/runtime/openclaw/agents/main/sessions")
    workspace_path: Path = Path("/app/runtime/workspace")
    audit_export_dir: Path = Path("/app/runtime/artifacts/exports")

    examples: tuple[str, ...] = (
        "Open docs.python.org, find the asyncio documentation, and summarize the main concepts.",
        "Go to wikipedia.org, search for Alan Turing, and extract five key facts with the article link.",
        "Open github.com, find the OpenClaw repository, and summarize what the project does.",
        "Search the web for the latest OpenClaw browser tool docs and return the official link.",
        "Open Habr, find a recent article about AI agents, and prepare a short digest with sources.",
    )

    @computed_field  # type: ignore[misc]
    @property
    def cors_origins(self) -> list[str]:
        return [origin.strip() for origin in self.frontend_origin.split(",") if origin.strip()]

    @computed_field  # type: ignore[misc]
    @property
    def gateway_ws_url(self) -> str:
        return self.openclaw_public_url.replace("http://", "ws://").replace("https://", "wss://")


@lru_cache
def get_settings() -> Settings:
    settings = Settings()
    settings.audit_export_dir.mkdir(parents=True, exist_ok=True)
    return settings
