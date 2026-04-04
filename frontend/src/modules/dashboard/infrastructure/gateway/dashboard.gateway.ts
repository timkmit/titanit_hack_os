import type { DashboardGatewayPort } from "@/modules/dashboard/application/ports/dashboard-gateway.port"
import type {
  AuditExportItem,
  AuditSessionSummary,
  RuntimeInfo,
  SessionTranscript,
} from "@/modules/dashboard/domain/entities/dashboard.entities"
import type {
  AuditExportsResponseDTO,
  AuditSessionsResponseDTO,
  RuntimeInfoDTO,
  SessionTranscriptDTO,
} from "@/modules/dashboard/infrastructure/dto/dashboard-api.dto"
import {
  mapAuditExport,
  mapAuditSession,
  mapRuntimeInfo,
  mapSessionTranscript,
} from "@/modules/dashboard/infrastructure/mappers/dashboard.mapper"
import { Result } from "@/shared/core/utils/result"
import type { DashboardHttpClient } from "@/shared/infrastructure/http/dashboard-http.client"

export class DashboardGateway implements DashboardGatewayPort {
  public constructor(private readonly http: DashboardHttpClient) {}

  public async getRuntimeInfo(): Promise<Result<RuntimeInfo>> {
    const result = await this.http.getJson<RuntimeInfoDTO>("/api/info")
    if (result.isFailure) {
      return Result.fail(result.error)
    }
    return Result.ok(mapRuntimeInfo(result.value))
  }

  public async listAuditSessions(): Promise<Result<AuditSessionSummary[]>> {
    const result = await this.http.getJson<AuditSessionsResponseDTO>(
      "/api/audit/sessions",
    )
    if (result.isFailure) {
      return Result.fail(result.error)
    }
    const items = (result.value.items ?? []).map(mapAuditSession)
    return Result.ok(items)
  }

  public async listAuditExports(): Promise<Result<AuditExportItem[]>> {
    const result = await this.http.getJson<AuditExportsResponseDTO>(
      "/api/audit/exports",
    )
    if (result.isFailure) {
      return Result.fail(result.error)
    }
    const items = (result.value.items ?? []).map(mapAuditExport)
    return Result.ok(items)
  }

  public async getSessionTranscript(
    sessionId: string,
  ): Promise<Result<SessionTranscript>> {
    const result = await this.http.getJson<SessionTranscriptDTO>(
      `/api/audit/sessions/${encodeURIComponent(sessionId)}`,
    )
    if (result.isFailure) {
      return Result.fail(result.error)
    }
    return Result.ok(mapSessionTranscript(result.value))
  }

  public async createAuditExport(): Promise<Result<void>> {
    return this.http.postJson("/api/audit/exports")
  }
}
