(() => {
  if (window.top !== window) return
  const btn = document.createElement("button")
  btn.textContent = "OpenClaw"
  btn.style.position = "fixed"
  btn.style.bottom = "16px"
  btn.style.right = "16px"
  btn.style.zIndex = "2147483647"
  btn.style.padding = "8px 12px"
  btn.style.borderRadius = "8px"
  btn.style.border = "none"
  btn.style.background = "#ff5a36"
  btn.style.color = "#fff"
  btn.style.fontSize = "14px"
  btn.style.cursor = "pointer"
  btn.style.boxShadow = "0 2px 8px rgba(0,0,0,0.2)"
  btn.addEventListener("click", () => {
    const url = chrome.runtime.getURL("src/popup/index.html")
    window.open(url, "_blank", "noopener,noreferrer,width=420,height=700")
  })
  document.documentElement.appendChild(btn)
})()

