# TOOLS.md

Browser defaults for this deployment:

- Gateway image is built from `gateway/Dockerfile` (Playwright Chromium). Plain `ghcr.io/openclaw/openclaw` without this layer has **no browser** → “No supported browser found”.
- Primary browser profile: `openclaw`
- Execution mode: headless
- Preferred interaction loop: `snapshot -> act -> verify`
- Safe browsing assumption: public internet only by default

Operator reminders:

- If a task needs authentication, let the user complete login first and then continue.
- If a site fails in `web_fetch`, switch to the browser tool.
- For extraction tasks, always include source links in the final answer.

## Page extract (HTML + YouTube metadata/comments)

When the user pastes a **public** page URL and wants text or (for YouTube) comments without opening the browser, call **`web_fetch`** on this **wrapper URL** (encode the user URL as the `url` query parameter):

`http://api:8000/api/tools/page-extract?url=<URL_ENCODED_USER_LINK>`

The response is JSON: `title`, `text`, `comments` (YouTube when yt-dlp returns them), `note`. This only works inside the Docker stack where hostname `api` resolves.

**Page-extract URL:** `http://api:8000/api/tools/page-extract?url=...` works only if `web_fetch` may reach the Docker service `api`. Many OpenClaw builds **block private IPs** and **reject unknown keys** in `tools.web.fetch` (no `ssrfPolicy` / `allowPrivateNetwork` in older schemas). If `web_fetch` is blocked, use the **browser** tool on the user’s link, or upgrade OpenClaw to a version that documents `tools.web.fetch.allowPrivateNetwork` and enable it when supported.
