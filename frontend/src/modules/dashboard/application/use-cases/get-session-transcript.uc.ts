import type { DashboardGatewayPort } from "@/modules/dashboard/application/ports/dashboard-gateway.port"
import type { SessionTranscript } from "@/modules/dashboard/domain/entities/dashboard.entities"
import { UseCase } from "@/shared/core/use-cases/use-case"
import { Result } from "@/shared/core/utils/result"

export type GetSessionTranscriptCommand = {
  sessionId: string
}

export class GetSessionTranscriptUC extends UseCase<
  GetSessionTranscriptCommand,
  SessionTranscript
> {
  public constructor(private readonly gateway: DashboardGatewayPort) {
    super()
  }

  public async execute(
    command: GetSessionTranscriptCommand,
  ): Promise<Result<SessionTranscript>> {
    if (!command.sessionId.trim()) {
      return Result.fail(new Error("Session id is required"))
    }
    return this.gateway.getSessionTranscript(command.sessionId)
  }
}
