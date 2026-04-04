import type { DashboardStore } from "@/modules/dashboard/interfaces/stores/dashboard.store"

let store: DashboardStore | null = null

export function initDashboardStore(instance: DashboardStore): void {
  store = instance
}

export function getDashboardStore(): DashboardStore {
  if (!store) {
    throw new Error("DashboardStore is not initialized; call registerDashboardModule() first")
  }
  return store
}
