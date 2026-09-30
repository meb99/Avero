import { cpSync, createReadStream, existsSync, statSync } from "node:fs";
import path from "node:path";
import { defineConfig, type Plugin } from "vitest/config";
import react from "@vitejs/plugin-react";
import pkg from "./package.json" with { type: "json" };

// pdf.js loads font data, CMaps, color profiles and WASM decoders at runtime.
// They are served from /pdfjs/ in development and copied into the build.
const PDFJS_ASSETS = ["cmaps", "standard_fonts", "wasm", "iccs"];
const pdfjsRoot = path.resolve("node_modules/pdfjs-dist");

function pdfjsAssets(): Plugin {
  return {
    name: "avero-pdfjs-assets",
    configureServer(server) {
      server.middlewares.use("/pdfjs", (req, res, next) => {
        const rel = decodeURIComponent((req.url ?? "").split("?")[0]).replace(/^\/+/, "");
        const file = path.join(pdfjsRoot, rel);
        const top = rel.split("/")[0];
        if (!PDFJS_ASSETS.includes(top) || !file.startsWith(pdfjsRoot) || !existsSync(file) || !statSync(file).isFile()) {
          return next();
        }
        createReadStream(file).pipe(res);
      });
    },
    writeBundle(options) {
      const out = options.dir ?? "dist";
      for (const dir of PDFJS_ASSETS) cpSync(path.join(pdfjsRoot, dir), path.join(out, "pdfjs", dir), { recursive: true });
    },
  };
}

// Tauri serves the dev build from a fixed port and expects no screen clearing.
export default defineConfig({
  plugins: [react(), pdfjsAssets()],
  clearScreen: false,
  server: { port: 1420, strictPort: true },
  envPrefix: ["VITE_", "TAURI_ENV_"],
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  // WKWebView on macOS 13+ is the only runtime.
  build: { target: "safari16", sourcemap: true },
  test: { environment: "node", include: ["src/**/*.test.ts"] },
});
