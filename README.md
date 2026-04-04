# Titanit Browser Agent

Dockerized OpenClaw deployment for a universal browser-control assistant.

## What This Project Does

- Accepts natural-language browser tasks through OpenClaw Control UI.
- Uses a local LLM via Ollama to plan and execute browser actions.
- Runs a dedicated, isolated browser profile for agent automation.
- Exposes an operator dashboard and audit API for session logs and exports.

## Architecture

- `openclaw-gateway`: agent runtime and Control UI.
- `ollama`: local model provider.
- `api`: FastAPI service for health, runtime info, session audit, and exports.
- `frontend`: React dashboard with status, examples, and audit browser.

## Quick Start

1. Copy `.env.example` to `.env`.
2. Replace `OPENCLAW_GATEWAY_TOKEN` with a real secret.
3. Start the stack:

```powershell
docker compose up -d --build
```

4. Open:

- Dashboard: `http://localhost:3000`
- Control UI: `http://localhost:18789`
- API docs: `http://localhost:8000/docs`

## GPU / Host Ollama Modes

- All-in-one local mode:

```powershell
docker compose -f docker-compose.yml -f compose.override.gpu.yml up -d --build
```

- Host Ollama mode:

```powershell
docker compose -f docker-compose.host.yml -f compose.override.gpu.yml up -d --build
```

## First Operator Flow

1. Open the Control UI.
2. Connect using:
   - WebSocket URL: `ws://127.0.0.1:18789`
   - Gateway token: value of `OPENCLAW_GATEWAY_TOKEN`
3. Ask the agent to do browser work, for example:
   - `Open habr.com, find the latest article about MCP, and give me a short summary with the link.`
   - `Go to wikipedia.org, search for Alan Turing, open the article, and extract the first 5 facts.`
   - `Open github.com, search for OpenClaw, and tell me what repository is official.`

## Audit and Logs

- Session list: `GET /api/audit/sessions`
- Session transcript: `GET /api/audit/sessions/{session_id}`
- Create export archive: `POST /api/audit/exports`

Exports include gateway config, workspace instructions, and current session transcripts.
