import type {
  AuditExportItem,
  AuditSessionSummary,
  RuntimeInfo,
  SessionTranscript,
  TranscriptEvent,
} from "@/modules/dashboard/domain/entities/dashboard.entities"
import type {
  AuditExportItemDTO,
  AuditSessionItemDTO,
  RuntimeInfoDTO,
  SessionTranscriptDTO,
  TranscriptEventDTO,
} from "@/modules/dashboard/infrastructure/dto/dashboard-api.dto"

export function mapRuntimeInfo(dto: RuntimeInfoDTO): RuntimeInfo {
  return {
    agentModel: dto.agent?.model ?? null,
    browserDefaultProfile: dto.browser?.defaultProfile ?? null,
    browserHeadless: dto.browser?.headless,
    toolsProfile: dto.tools?.profile ?? null,
    examples: dto.examples ?? [],
  }
}

export function mapAuditSession(dto: AuditSessionItemDTO): AuditSessionSummary {
  return {
    sessionId: dto.sessionId,
    updatedAt: dto.updatedAt ?? null,
    startedAt: dto.startedAt ?? null,
    model: dto.model ?? null,
  }
}

export function mapAuditExport(dto: AuditExportItemDTO): AuditExportItem {
  return {
    name: dto.name,
    createdAt: dto.createdAt ?? null,
  }
}

function mapTranscriptEvent(dto: TranscriptEventDTO): TranscriptEvent {
  return {
    type: dto.type,
    role: dto.role ?? null,
    customType: dto.customType ?? null,
    timestamp: dto.timestamp ?? null,
    summary: dto.summary,
    toolCalls: dto.toolCalls ?? null,
  }
}

export function mapSessionTranscript(dto: SessionTranscriptDTO): SessionTranscript {
  return {
    events: (dto.events ?? []).map(mapTranscriptEvent),
  }
}
