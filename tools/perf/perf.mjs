// Times Avero's main thread on a big board: loading, selecting, searching, hovering,
// zooming, lists. For each step: wall time until the page is idle again, the main thread's
// busy time from a CPU profile, and the functions that took most of it.
// Usage: node perf.mjs <board.json> [steps,comma,separated]
import { createReadStream } from "node:fs";
import { createServer } from "node:http";
import { boardArg, openApp } from "../browser-tests/common.mjs";

const board = boardArg();
const only = process.argv[3]?.split(",");
const m = board.model;
// The board comes over HTTP, as a big one does not fit into the page's start-up script.
const server = createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
  createReadStream(board.path).pipe(res);
}).listen(0);
const boardUrl = `http://localhost:${server.address().port}/board.json`;
const { page, find, tab, finish: close } = await openApp("{}", { viewport: { width: 1600, height: 1000 }, files: [], recent: ["/x/board.cad"] });
const finish = async (label) => {
  await close(label);
  server.close();
};
await page.evaluate((url) => {
  const mock = window.__TAURI_INTERNALS__.invoke;
  window.__TAURI_INTERNALS__.invoke = async (cmd, args) => {
    if (cmd !== "open_board" && cmd !== "open_demo") return mock(cmd, args);
    const t = performance.now();
    const text = await (await fetch(url)).text();
    const t1 = performance.now();
    const board = JSON.parse(text);
    console.info(`[perf] JSON: ${(text.length / 1048576).toFixed(0)} MB, fetch ${(t1 - t).toFixed(0)} ms, parse ${(performance.now() - t1).toFixed(0)} ms`);
    return board;
  };
}, boardUrl);
page.on("console", (msg) => msg.text().startsWith("[perf]") && console.log(msg.text()));
console.log(`${m.parts.length} parts, ${m.pins.length} pins, ${m.nets.length} nets, ${m.traces?.length ?? 0} traces, ${m.testPoints.length} vias and test points`);

const cdp = await page.context().newCDPSession(page);
await cdp.send("Profiler.enable");
await cdp.send("Profiler.setSamplingInterval", { interval: 500 });
const idle = () =>
  page.evaluate(
    () =>
      new Promise((done) => {
        // Two frames with nothing to do in between.
        const frame = () => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(done, 60)));
        frame();
      }),
  );

async function measure(name, fn) {
  if (only && !only.includes(name)) return;
  await idle();
  await cdp.send("Profiler.start");
  const start = Date.now();
  let error = "";
  try {
    await fn();
    await idle();
  } catch (e) {
    error = ` (${String(e).split("\n")[0]})`;
  }
  const wall = Date.now() - start;
  const { profile } = await cdp.send("Profiler.stop");
  const self = new Map();
  const dt = profile.timeDeltas ?? [];
  const byId = new Map(profile.nodes.map((n) => [n.id, n]));
  let busy = 0;
  profile.samples.forEach((id, i) => {
    const n = byId.get(id);
    const f = n.callFrame;
    if (f.functionName === "(idle)") return;
    const us = dt[i] ?? 0;
    busy += us;
    const where = f.url ? `${f.functionName || "(anonymous)"} ${f.url.split("/").slice(-2).join("/").split("?")[0]}:${f.lineNumber + 1}` : f.functionName;
    self.set(where, (self.get(where) ?? 0) + us);
  });
  const top = [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, 7);
  console.log(`\n${name}: ${wall} ms wall, ${(busy / 1000).toFixed(0)} ms busy${error}`);
  for (const [where, us] of top) if (us > 4000) console.log(`   ${(us / 1000).toFixed(0).padStart(6)} ms  ${where}`);
}

await measure("load (open from recent until idle)", async () => {
  await page.keyboard.press("Meta+k");
  await page.waitForSelector(".palette-list", { timeout: 20000 });
  await page.keyboard.type("Zuletzt geöffnet: board.cad", { delay: 0 });
  await page.keyboard.press("Enter");
  await page.waitForSelector(".board-view", { timeout: 300000 });
});
const view = page.locator(".board-view").first();
const box = await view.boundingBox();
const center = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
const big = m.parts.reduce((a, p) => (p.pinCount > a.pinCount ? p : a), m.parts[0]);
const passive = m.parts.find((p) => p.pinCount === 2);
const rail = m.nets.filter((n) => n.kind === "power").reduce((a, n) => (n.pins.length > (a?.pins.length ?? 0) ? n : a), null);
const signal = m.nets.find((n) => n.kind === "signal" && n.pins.length >= 4);
const palette = async (text) => {
  await page.evaluate(() => document.activeElement?.blur());
  await page.keyboard.press("Meta+k");
  await page.waitForSelector(".palette-list", { timeout: 20000 });
  await page.keyboard.type(text, { delay: 0 });
};

await measure("select part (find)", () => find(passive.name));
await measure("select big part", () => find(big.name));
await measure("select signal net", () => find(signal.name));
await measure(`select rail ${rail?.name} (${rail?.pins.length} pins)`, () => find(rail.name));
await measure("clear selection", async () => {
  await page.evaluate(() => document.activeElement?.blur());
  await page.keyboard.press("Escape");
});
await measure("fit", () => page.keyboard.press("f"));
await measure("zoom in x3 (wheel)", async () => {
  await page.mouse.move(center.x, center.y);
  for (let i = 0; i < 3; i++) await page.mouse.wheel(0, -240);
});
await measure("pan (drag 5 steps)", async () => {
  await page.mouse.move(center.x, center.y);
  await page.mouse.down();
  for (let i = 1; i <= 5; i++) await page.mouse.move(center.x - i * 40, center.y - i * 20);
  await page.mouse.up();
});
await measure("hover (10 moves)", async () => {
  for (let i = 0; i < 10; i++) await page.mouse.move(center.x - 200 + i * 40, center.y - 100 + i * 20);
});
await measure("click on the board x5", async () => {
  for (let i = 0; i < 5; i++) await page.mouse.click(center.x - 150 + i * 60, center.y - 80 + i * 30);
});
await measure("flip side", () => page.keyboard.press("Space"));
await measure("flip back", () => page.keyboard.press("Space"));
await measure("fit again", () => page.keyboard.press("f"));
await measure("palette: type a part name", async () => {
  await palette(passive.name);
  await page.keyboard.press("Escape");
});
await measure("palette: type 'SIG_1'", async () => {
  await palette("SIG_1");
  await page.keyboard.press("Escape");
});
await measure("find dialog: type 'C10'", async () => {
  await page.evaluate(() => document.activeElement?.blur());
  await page.keyboard.press("Meta+f");
  await page.waitForSelector(".find-dialog #find-0", { timeout: 20000 });
  await page.locator(".find-dialog #find-0").pressSequentially("C10", { delay: 0 });
  await page.keyboard.press("Escape");
});
await find(big.name);
for (const section of ["Bauteile (", "Netze (", "Details", "Lagen", "Messen", "Fehlersuche"])
  await measure(`open section ${section}`, async () => {
    if (await page.locator(".info-section .section-head", { hasText: section }).count()) await tab(section);
  });
await measure("select another part with lists open", () => find(passive.name));
await measure("both sides", () => page.keyboard.press("b"));
await measure("one side", () => page.keyboard.press("b"));
await finish(`perf on ${board.name}`);
