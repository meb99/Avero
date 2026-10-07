// Shared set-up of the browser tests: the app from the Vite dev server in Chromium, with the
// Tauri side replaced by a mock that hands out one board (a JSON from `avero-inspect --json`)
// and keeps notes and stores in memory. Nothing is read from or written to disk.
import { mkdirSync, readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

export const OUT = join(dirname(fileURLToPath(import.meta.url)), "out");
mkdirSync(OUT, { recursive: true });

export const URL = process.env.AVERO_URL ?? "http://localhost:1420/";

/** The board JSON given on the command line, or the demo board made by run.sh. */
export function boardArg(index = 2) {
  const path = process.argv[index] ?? join(OUT, "demo.json");
  return { path, name: basename(path, ".json"), json: readFileSync(path, "utf8"), model: JSON.parse(readFileSync(path, "utf8")) };
}

/**
 * Opens the app on a board. `level` is the interface level the app starts with ("view" or
 * "workshop"); `notes` (optional) is what the notes of the board hold when first loaded.
 */
export async function openApp(boardJson, { level = "workshop", notes = null, viewport = { width: 1300, height: 820 } } = {}) {
  // CHROMIUM: a Chromium binary to use instead of Playwright's own (npx playwright install chromium).
  const browser = await chromium.launch({
    ...(process.env.CHROMIUM && { executablePath: process.env.CHROMIUM }),
    args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
  });
  const page = await browser.newPage({ viewport, deviceScaleFactor: 1, locale: "de-DE", colorScheme: "dark" });
  const logs = [];
  page.on("pageerror", (e) => logs.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    if ((m.type() === "error" || m.type() === "warning") && !/404|Failed to load resource/.test(m.text())) logs.push(`console ${m.type()}: ${m.text().slice(0, 200)}`);
  });
  await page.route("https://api.github.com/**", (route) => route.fulfill({ status: 404, body: "" }));
  await page.addInitScript(
    ({ boardJson, level, notes }) => {
      try {
        if (!localStorage.getItem("avero.settings.v1")) localStorage.setItem("avero.settings.v1", JSON.stringify({ revision: 2, uiLevel: level }));
      } catch {}
      window.__saved = {};
      window.__seed = notes;
      window.__stores = { workspace: JSON.stringify({ version: 1, active: 0, tabs: [{ path: "/x/board.cad", schematicVisible: false }] }) };
      window.__TAURI_INTERNALS__ = {
        metadata: { currentWindow: { label: "main" }, currentWebview: { windowLabel: "main", label: "main" } },
        transformCallback: (cb) => {
          const id = Math.floor(Math.random() * 1e9);
          window[`_${id}`] = cb;
          return id;
        },
        invoke: async (cmd, args) => {
          if (cmd.startsWith("plugin:menu|")) throw new Error("no menu");
          switch (cmd) {
            case "open_board":
              return JSON.parse(boardJson);
            case "take_pending_paths":
              return [];
            case "plugin:event|listen":
              return 1;
            case "load_notes":
              return window.__saved[args.key] ?? (window.__seed ? JSON.stringify({ ...window.__seed, key: args.key }) : null);
            case "save_notes":
              window.__saved[args.key] = args.data;
              return null;
            case "load_store":
              return window.__stores[args.name] ?? null;
            case "save_store":
              return null;
            case "schematics_for":
            case "meter_ports":
              return [];
            case "mcp_status":
              return null;
            case "app_executable":
              return "/Applications/Avero.app/Contents/MacOS/avero";
            default:
              return null;
          }
        },
      };
      window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener() {} };
    },
    { boardJson, level, notes },
  );
  await page.goto(URL);
  await page.waitForSelector(".board-view", { timeout: 30000 });
  await page.waitForTimeout(1500);

  const step = async (name, fn) => {
    try {
      await fn();
    } catch (e) {
      logs.push(`step ${name}: ${String(e).split("\n")[0]}`);
    }
  };
  const find = async (q) => {
    const s = page.getByRole("searchbox").first();
    await s.fill(q);
    await s.press("Enter");
    await page.waitForTimeout(700);
  };
  const tab = (name) => page.locator(".sidebar [role=tab]", { hasText: name }).first().click();
  const shot = async (name, selector) => {
    await page.evaluate(() => document.activeElement?.blur());
    const path = join(OUT, `${name}.png`);
    await (selector ? page.locator(selector).first().screenshot({ path }) : page.screenshot({ path }));
    return path;
  };
  /** What the app saved as notes, parsed. */
  const savedNotes = () => page.evaluate(() => Object.values(window.__saved).map((d) => JSON.parse(d)));
  /** Prints the errors and exits non-zero when there were any. */
  const finish = async (label) => {
    const unique = [...new Set(logs)];
    console.log(`${label}: ${unique.length ? unique.join("\n") : "no errors"}`);
    await browser.close();
    if (unique.length) process.exitCode = 1;
  };
  return { browser, page, logs, step, find, tab, shot, savedNotes, finish };
}
