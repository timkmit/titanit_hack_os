import type { DashboardGatewayPort } from "@/modules/dashboard/application/ports/dashboard-gateway.port"
import type { DashboardSnapshot } from "@/modules/dashboard/domain/entities/dashboard.entities"
import type { EmptyCommand } from "@/shared/core/use-cases/empty-command"
import { UseCase } from "@/shared/core/use-cases/use-case"
import { Result } from "@/shared/core/utils/result"

export class LoadDashboardUC extends UseCase<EmptyCommand, DashboardSnapshot> {
  public constructor(private readonly gateway: DashboardGatewayPort) {
    super()
  }

  public async execute(_command: EmptyCommand): Promise<Result<DashboardSnapshot>> {
    const [infoRes, sessionsRes, exportsRes] = await Promise.all([
      this.gateway.getRuntimeInfo(),
      this.gateway.listAuditSessions(),
      this.gateway.listAuditExports(),
    ])

    if (infoRes.isFailure) {
      return Result.fail(infoRes.error)
    }
    if (sessionsRes.isFailure) {
      return Result.fail(sessionsRes.error)
    }
    if (exportsRes.isFailure) {
      return Result.fail(exportsRes.error)
    }

    return Result.ok({
      info: infoRes.value,
      sessions: sessionsRes.value,
      exports: exportsRes.value,
    })
  }
}
