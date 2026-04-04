import { CreateAuditExportUC } from "@/modules/dashboard/application/use-cases/create-audit-export.uc"
import { GetSessionTranscriptUC } from "@/modules/dashboard/application/use-cases/get-session-transcript.uc"
import { ListAuditExportsUC } from "@/modules/dashboard/application/use-cases/list-audit-exports.uc"
import { LoadDashboardUC } from "@/modules/dashboard/application/use-cases/load-dashboard.uc"
import { DashboardGateway } from "@/modules/dashboard/infrastructure/gateway/dashboard.gateway"
import { initDashboardStore } from "@/modules/dashboard/interfaces/factories/dashboard-store.factory"
import { DashboardStore } from "@/modules/dashboard/interfaces/stores/dashboard.store"
import { getApiBaseUrl } from "@/shared/infrastructure/config/app-config"
import { DashboardHttpClient } from "@/shared/infrastructure/http/dashboard-http.client"

let registered = false

export function registerDashboardModule(): void {
  if (registered) {
    return
  }
  registered = true

  const http = new DashboardHttpClient(getApiBaseUrl())
  const gateway = new DashboardGateway(http)

  const loadDashboard = new LoadDashboardUC(gateway)
  const getTranscript = new GetSessionTranscriptUC(gateway)
  const createExport = new CreateAuditExportUC(gateway)
  const listExports = new ListAuditExportsUC(gateway)

  initDashboardStore(
    new DashboardStore(
      loadDashboard,
      getTranscript,
      createExport,
      listExports,
    ),
  )
}
