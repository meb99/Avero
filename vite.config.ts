import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import pkg from "./package.json" with { type: "json" };

// Tauri serves the dev build from a fixed port and expects no screen clearing.
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: { port: 1420, strictPort: true },
  envPrefix: ["VITE_", "TAURI_ENV_"],
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  // WKWebView on macOS 12+ (Safari 15) is the only runtime.
  build: { target: "safari15", sourcemap: true },
  test: { environment: "node", include: ["src/**/*.test.ts"] },
});
