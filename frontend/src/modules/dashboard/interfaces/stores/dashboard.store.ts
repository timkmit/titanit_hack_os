import type { CreateAuditExportUC } from "@/modules/dashboard/application/use-cases/create-audit-export.uc"
import type { GetSessionTranscriptUC } from "@/modules/dashboard/application/use-cases/get-session-transcript.uc"
import type { ListAuditExportsUC } from "@/modules/dashboard/application/use-cases/list-audit-exports.uc"
import type { LoadDashboardUC } from "@/modules/dashboard/application/use-cases/load-dashboard.uc"
import type {
  AuditExportItem,
  AuditSessionSummary,
  RuntimeInfo,
  SessionTranscript,
} from "@/modules/dashboard/domain/entities/dashboard.entities"

export type DashboardState = {
  info: RuntimeInfo | null
  sessions: AuditSessionSummary[]
  exports: AuditExportItem[]
  selectedSessionId: string | null
  transcript: SessionTranscript | null
  exportBusy: boolean
}

const initialState: DashboardState = {
  info: null,
  sessions: [],
  exports: [],
  selectedSessionId: null,
  transcript: null,
  exportBusy: false,
}

export class DashboardStore {
  private state: DashboardState = { ...initialState }
  private readonly listeners = new Set<() => void>()

  public constructor(
    private readonly loadDashboard: LoadDashboardUC,
    private readonly getTranscript: GetSessionTranscriptUC,
    private readonly createExport: CreateAuditExportUC,
    private readonly listExports: ListAuditExportsUC,
  ) {}

  public subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  public getSnapshot = (): DashboardState => this.state

  public async loadInitial(): Promise<void> {
    const result = await this.loadDashboard.execute({})
    result.match({
      success: (snapshot) => {
        this.patch({
          info: snapshot.info,
          sessions: snapshot.sessions,
          exports: snapshot.exports,
        })
      },
      failure: (error) => {
        console.error(error)
      },
    })
  }

  public async openSession(sessionId: string): Promise<void> {
    this.patch({ selectedSessionId: sessionId, transcript: null })
    const result = await this.getTranscript.execute({ sessionId })
    result.match({
      success: (transcript) => {
        this.patch({ transcript })
      },
      failure: (error) => {
        console.error(error)
        this.patch({ selectedSessionId: null })
      },
    })
  }

  public async createExportArchive(): Promise<void> {
    this.patch({ exportBusy: true })
    const created = await this.createExport.execute({})
    if (created.isFailure) {
      console.error(created.error)
      this.patch({ exportBusy: false })
      return
    }
    const listed = await this.listExports.execute({})
    listed.match({
      success: (exports) => {
        this.patch({ exports, exportBusy: false })
      },
      failure: (error) => {
        console.error(error)
        this.patch({ exportBusy: false })
      },
    })
  }

  private patch(patch: Partial<DashboardState>): void {
    this.state = { ...this.state, ...patch }
    this.listeners.forEach((listener) => {
      listener()
    })
  }
}
