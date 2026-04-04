export function getApiBaseUrl(): string {
  return (
    import.meta.env.VITE_API_BASE_URL ||
    `http://${window.location.hostname || "localhost"}:8000`
  )
}

export function getControlUiUrl(): string {
  return (
    import.meta.env.VITE_CONTROL_UI_URL ||
    `http://${window.location.hostname || "localhost"}:18789`
  )
}
