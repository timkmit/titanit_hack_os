import { defineConfig } from "vite"
import { resolve } from "node:path"

export default defineConfig({
  base: "./",
  build: {
    outDir: "dist",
    rollupOptions: {
      input: {
        popup: resolve(__dirname, "src/popup/index.html"),
        background: resolve(__dirname, "src/background.ts"),
        content: resolve(__dirname, "src/content.ts")
      },
      output: {
        entryFileNames: (chunk) => {
          if (chunk.name === "background") return "background.js"
          if (chunk.name === "content") return "content.js"
          return "assets/[name]-[hash].js"
        }
      }
    }
  }
})

