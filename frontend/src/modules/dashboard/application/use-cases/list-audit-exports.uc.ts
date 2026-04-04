import type { DashboardGatewayPort } from "@/modules/dashboard/application/ports/dashboard-gateway.port"
import type { AuditExportItem } from "@/modules/dashboard/domain/entities/dashboard.entities"
import type { EmptyCommand } from "@/shared/core/use-cases/empty-command"
import { UseCase } from "@/shared/core/use-cases/use-case"
import { Result } from "@/shared/core/utils/result"

export class ListAuditExportsUC extends UseCase<EmptyCommand, AuditExportItem[]> {
  public constructor(private readonly gateway: DashboardGatewayPort) {
    super()
  }

  public async execute(_command: EmptyCommand): Promise<Result<AuditExportItem[]>> {
    return this.gateway.listAuditExports()
  }
}
