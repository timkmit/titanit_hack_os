export type RuntimeInfoDTO = {
  agent?: { model?: string }
  browser?: { defaultProfile?: string; headless?: unknown }
  tools?: { profile?: string }
  examples?: string[]
}

export type AuditSessionItemDTO = {
  sessionId: string
  updatedAt?: string
  startedAt?: string
  model?: string
}

export type AuditSessionsResponseDTO = {
  items?: AuditSessionItemDTO[]
}

export type AuditExportItemDTO = {
  name: string
  createdAt?: string
}

export type AuditExportsResponseDTO = {
  items?: AuditExportItemDTO[]
}

export type TranscriptEventDTO = {
  type: string
  role?: string
  customType?: string
  timestamp?: string
  summary?: unknown
  toolCalls?: unknown[]
}

export type SessionTranscriptDTO = {
  events?: TranscriptEventDTO[]
}
