import { useSyncExternalStore } from "react"
import { getDashboardStore } from "@/modules/dashboard/interfaces/factories/dashboard-store.factory"

export function useDashboardStore() {
  const store = getDashboardStore()
  const state = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getSnapshot,
  )
  return { store, state }
}
