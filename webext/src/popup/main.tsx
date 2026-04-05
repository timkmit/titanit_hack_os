import React from "react"
import { createRoot } from "react-dom/client"
import "../styles.css"
import { App } from "./App"

document.documentElement.dataset.displayMode =
  new URLSearchParams(window.location.search).get("mode") === "window" ? "window" : "popup"

const container = document.getElementById("root")
if (container) {
  const root = createRoot(container)
  root.render(<App />)
}
