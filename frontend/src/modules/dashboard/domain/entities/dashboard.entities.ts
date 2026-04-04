export type RuntimeInfo = {
  agentModel: string | null
  browserDefaultProfile: string | null
  browserHeadless: unknown
  toolsProfile: string | null
  examples: string[]
}

export type AuditSessionSummary = {
  sessionId: string
  updatedAt: string | null
  startedAt: string | null
  model: string | null
}

export type AuditExportItem = {
  name: string
  createdAt: string | null
}

export type TranscriptEvent = {
  type: string
  role: string | null
  customType: string | null
  timestamp: string | null
  summary: unknown
  toolCalls: unknown[] | null
}

export type SessionTranscript = {
  events: TranscriptEvent[]
}

export type DashboardSnapshot = {
  info: RuntimeInfo
  sessions: AuditSessionSummary[]
  exports: AuditExportItem[]
}
