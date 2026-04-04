import type {
  AuditExportItem,
  AuditSessionSummary,
  RuntimeInfo,
  SessionTranscript,
} from "@/modules/dashboard/domain/entities/dashboard.entities"
import type { Result } from "@/shared/core/utils/result"

export interface DashboardGatewayPort {
  getRuntimeInfo(): Promise<Result<RuntimeInfo>>
  listAuditSessions(): Promise<Result<AuditSessionSummary[]>>
  listAuditExports(): Promise<Result<AuditExportItem[]>>
  getSessionTranscript(sessionId: string): Promise<Result<SessionTranscript>>
  createAuditExport(): Promise<Result<void>>
}
