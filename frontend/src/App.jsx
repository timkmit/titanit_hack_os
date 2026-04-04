import { useEffect, useState } from "react";

const apiBase =
  import.meta.env.VITE_API_BASE_URL ||
  `http://${window.location.hostname || "localhost"}:8000`;
const controlUiUrl =
  import.meta.env.VITE_CONTROL_UI_URL ||
  `http://${window.location.hostname || "localhost"}:18789`;

function formatValue(value) {
  if (value === null || value === undefined || value === "") {
    return "—";
  }
  if (typeof value === "object") {
    return JSON.stringify(value, null, 2);
  }
  return String(value);
}

export default function App() {
  const [info, setInfo] = useState(null);
  const [sessions, setSessions] = useState([]);
  const [selectedSession, setSelectedSession] = useState(null);
  const [selectedTranscript, setSelectedTranscript] = useState(null);
  const [exports, setExports] = useState([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    async function load() {
      const [infoRes, sessionsRes, exportsRes] = await Promise.all([
        fetch(`${apiBase}/api/info`),
        fetch(`${apiBase}/api/audit/sessions`),
        fetch(`${apiBase}/api/audit/exports`),
      ]);

      const infoJson = await infoRes.json();
      const sessionsJson = await sessionsRes.json();
      const exportsJson = await exportsRes.json();

      setInfo(infoJson);
      setSessions(sessionsJson.items || []);
      setExports(exportsJson.items || []);
    }

    load().catch(console.error);
  }, []);

  async function openSession(sessionId) {
    setSelectedSession(sessionId);
    const response = await fetch(`${apiBase}/api/audit/sessions/${sessionId}`);
    const payload = await response.json();
    setSelectedTranscript(payload);
  }

  async function createExport() {
    setBusy(true);
    try {
      await fetch(`${apiBase}/api/audit/exports`, { method: "POST" });
      const exportsRes = await fetch(`${apiBase}/api/audit/exports`);
      const exportsJson = await exportsRes.json();
      setExports(exportsJson.items || []);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="app-shell">
      <section className="hero">
        <div>
          <p className="eyebrow">Titanit Hackathon</p>
          <h1>Browser agent control surface</h1>
          <p className="lead">
            OpenClaw handles the agent loop. This dashboard gives you status,
            operator entry points, prompt examples, and session audit trails.
          </p>
        </div>
        <div className="hero-actions">
          <a className="primary-btn" href={controlUiUrl} target="_blank" rel="noreferrer">
            Open Control UI
          </a>
          <a className="secondary-btn" href={`${apiBase}/docs`} target="_blank" rel="noreferrer">
            Open API Docs
          </a>
        </div>
      </section>

      <section className="grid">
        <article className="card">
          <h2>Runtime</h2>
          <dl className="info-list">
            <div>
              <dt>Model</dt>
              <dd>{info?.agent?.model || "Loading..."}</dd>
            </div>
            <div>
              <dt>Browser profile</dt>
              <dd>{info?.browser?.defaultProfile || "Loading..."}</dd>
            </div>
            <div>
              <dt>Headless</dt>
              <dd>{formatValue(info?.browser?.headless)}</dd>
            </div>
            <div>
              <dt>Tool profile</dt>
              <dd>{info?.tools?.profile || "Loading..."}</dd>
            </div>
          </dl>
        </article>

        <article className="card">
          <h2>How to use</h2>
          <ol className="steps">
            <li>Open Control UI and connect with the gateway token.</li>
            <li>Give the agent a browser task in natural language.</li>
            <li>Review session traces here after the run completes.</li>
          </ol>
        </article>
      </section>

      <section className="grid">
        <article className="card">
          <div className="section-header">
            <h2>Prompt examples</h2>
          </div>
          <ul className="examples">
            {(info?.examples || []).map((example) => (
              <li key={example}>{example}</li>
            ))}
          </ul>
        </article>

        <article className="card">
          <div className="section-header">
            <h2>Audit exports</h2>
            <button className="secondary-btn small" onClick={createExport} disabled={busy}>
              {busy ? "Exporting..." : "Create export"}
            </button>
          </div>
          <ul className="exports">
            {exports.map((item) => (
              <li key={item.name}>
                <a href={`${apiBase}/api/audit/exports/${item.name}`}>{item.name}</a>
                <span>{item.createdAt}</span>
              </li>
            ))}
            {!exports.length && <li>No exports yet.</li>}
          </ul>
        </article>
      </section>

      <section className="grid audit-grid">
        <article className="card">
          <h2>Sessions</h2>
          <ul className="sessions">
            {sessions.map((session) => (
              <li key={session.sessionId}>
                <button
                  className={selectedSession === session.sessionId ? "session-btn active" : "session-btn"}
                  onClick={() => openSession(session.sessionId)}
                >
                  <strong>{session.sessionId}</strong>
                  <span>{session.updatedAt || session.startedAt || "No timestamp"}</span>
                  <span>{session.model || "Unknown model"}</span>
                </button>
              </li>
            ))}
            {!sessions.length && <li>No sessions recorded yet.</li>}
          </ul>
        </article>

        <article className="card transcript-card">
          <h2>Transcript</h2>
          {selectedTranscript ? (
            <div className="transcript">
              {selectedTranscript.events.map((event, index) => (
                <div key={`${event.timestamp}-${index}`} className="transcript-event">
                  <div className="transcript-meta">
                    <span>{event.type}</span>
                    <span>{event.role || event.customType || "system"}</span>
                    <span>{event.timestamp || "n/a"}</span>
                  </div>
                  {event.summary && <pre>{formatValue(event.summary)}</pre>}
                  {event.toolCalls?.length ? (
                    <pre>{formatValue(event.toolCalls)}</pre>
                  ) : null}
                </div>
              ))}
            </div>
          ) : (
            <p className="empty-state">Choose a session to inspect its trace.</p>
          )}
        </article>
      </section>
    </main>
  );
}
