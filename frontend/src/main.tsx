import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { registerDashboardModule } from "@/modules/dashboard/dashboard.module"
import App from "@/App"
import "./styles.css"

registerDashboardModule()

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
