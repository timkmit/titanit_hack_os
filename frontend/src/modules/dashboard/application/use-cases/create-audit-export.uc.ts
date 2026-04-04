import type { DashboardGatewayPort } from "@/modules/dashboard/application/ports/dashboard-gateway.port"
import type { EmptyCommand } from "@/shared/core/use-cases/empty-command"
import { UseCase } from "@/shared/core/use-cases/use-case"
import { Result } from "@/shared/core/utils/result"

export class CreateAuditExportUC extends UseCase<EmptyCommand, void> {
  public constructor(private readonly gateway: DashboardGatewayPort) {
    super()
  }

  public async execute(_command: EmptyCommand): Promise<Result<void>> {
    return this.gateway.createAuditExport()
  }
}
