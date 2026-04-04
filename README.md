# Titanit Browser Agent

OpenClaw-based browser agent with a local host Ollama model and a Chrome extension popup.

## Stack

- `openclaw-gateway`: agent runtime, Control UI, browser tools
- `api`: FastAPI health and audit endpoints
- `frontend`: dashboard
- `webext`: Chrome extension popup chat
- `ollama`: runs on the host machine, not in Docker

## Required Host Model

Install Ollama on the host and pull this model:

```powershell
ollama pull qwen2.5:7b-instruct
```

This is the model the project is configured to use by default.

## Quick Start

1. Copy `.env.example` to `.env`.
2. Set `OPENCLAW_GATEWAY_TOKEN` to a real secret.
3. Make sure Ollama is running on the host at `http://localhost:11434`.
4. Start the stack:

```powershell
docker compose up -d --build
```

5. Open:

- Dashboard: `http://localhost:3000`
- Control UI: `http://localhost:18789`
- API docs: `http://localhost:8000/docs`

## Chrome Extension

Build the extension:

```powershell
cd webext
npm i
npm run build
```

Load it in Chrome:

1. Open `chrome://extensions`
2. Enable Developer mode
3. Click `Load unpacked`
4. Select `webext/dist`

In the extension popup, enter:

- Gateway URL: `http://localhost:18789`
- Gateway token: the value of `OPENCLAW_GATEWAY_TOKEN`

## Demo Prompt

```text
Open example.com in the browser, wait for the page to load, then tell me the page title and current URL.
```

## Audit API

- `GET /api/audit/sessions`
- `GET /api/audit/sessions/{session_id}`
- `POST /api/audit/exports`
