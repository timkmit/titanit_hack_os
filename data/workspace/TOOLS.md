# TOOLS.md

Browser defaults for this deployment:

- Primary browser profile: `openclaw`
- Execution mode: headless
- Preferred interaction loop: `snapshot -> act -> verify`
- Safe browsing assumption: public internet only by default

Operator reminders:

- If a task needs authentication, let the user complete login first and then continue.
- If a site fails in `web_fetch`, switch to the browser tool.
- For extraction tasks, always include source links in the final answer.
