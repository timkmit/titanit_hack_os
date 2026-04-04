import { useEffect } from "react"
import { formatDisplayValue } from "@/shared/core/utils/format-display-value"
import { getApiBaseUrl, getControlUiUrl } from "@/shared/infrastructure/config/app-config"
import { useDashboardStore } from "@/modules/dashboard/interfaces/hooks/use-dashboard-store"

export function DashboardPage() {
  const { store, state } = useDashboardStore()
  const apiBase = getApiBaseUrl()
  const controlUiUrl = getControlUiUrl()

  useEffect(() => {
    void store.loadInitial()
  }, [store])

  const { info, sessions, exports, selectedSessionId, transcript, exportBusy } = state

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
          <a
            className="primary-btn"
            href={controlUiUrl}
            target="_blank"
            rel="noreferrer"
          >
            Open Control UI
          </a>
          <a
            className="secondary-btn"
            href={`${apiBase}/docs`}
            target="_blank"
            rel="noreferrer"
          >
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
              <dd>{info?.agentModel ?? "Loading..."}</dd>
            </div>
            <div>
              <dt>Browser profile</dt>
              <dd>{info?.browserDefaultProfile ?? "Loading..."}</dd>
            </div>
            <div>
              <dt>Headless</dt>
              <dd>{formatDisplayValue(info?.browserHeadless)}</dd>
            </div>
            <div>
              <dt>Tool profile</dt>
              <dd>{info?.toolsProfile ?? "Loading..."}</dd>
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
            {(info?.examples ?? []).map((example) => (
              <li key={example}>{example}</li>
            ))}
          </ul>
        </article>

        <article className="card">
          <div className="section-header">
            <h2>Audit exports</h2>
            <button
              type="button"
              className="secondary-btn small"
              onClick={() => void store.createExportArchive()}
              disabled={exportBusy}
            >
              {exportBusy ? "Exporting..." : "Create export"}
            </button>
          </div>
          <ul className="exports">
            {exports.map((item) => (
              <li key={item.name}>
                <a href={`${apiBase}/api/audit/exports/${item.name}`}>
                  {item.name}
                </a>
                <span>{item.createdAt ?? ""}</span>
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
                  type="button"
                  className={
                    selectedSessionId === session.sessionId
                      ? "session-btn active"
                      : "session-btn"
                  }
                  onClick={() => void store.openSession(session.sessionId)}
                >
                  <strong>{session.sessionId}</strong>
                  <span>
                    {session.updatedAt ||
                      session.startedAt ||
                      "No timestamp"}
                  </span>
                  <span>{session.model ?? "Unknown model"}</span>
                </button>
              </li>
            ))}
            {!sessions.length && <li>No sessions recorded yet.</li>}
          </ul>
        </article>

        <article className="card transcript-card">
          <h2>Transcript</h2>
          {transcript ? (
            <div className="transcript">
              {transcript.events.map((event, index) => (
                <div
                  key={`${event.timestamp}-${index}`}
                  className="transcript-event"
                >
                  <div className="transcript-meta">
                    <span>{event.type}</span>
                    <span>
                      {event.role || event.customType || "system"}
                    </span>
                    <span>{event.timestamp ?? "n/a"}</span>
                  </div>
                  {event.summary != null && event.summary !== "" ? (
                    <pre>{formatDisplayValue(event.summary)}</pre>
                  ) : null}
                  {event.toolCalls?.length ? (
                    <pre>{formatDisplayValue(event.toolCalls)}</pre>
                  ) : null}
                </div>
              ))}
            </div>
          ) : (
            <p className="empty-state">
              Choose a session to inspect its trace.
            </p>
          )}
        </article>
      </section>
    </main>
  )
}
