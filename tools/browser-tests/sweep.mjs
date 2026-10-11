// Goes through the whole app on one board and reports every error on the page:
// searches, every sidebar tab, the guides, keys, clicks, palette, settings, help,
// library, BGA view and signal path. Usage: node sweep.mjs [board.json] [view|workshop]
import { boardArg, openApp } from "./common.mjs";

const board = boardArg();
const level = process.argv[3] === "view" ? "view" : "workshop";
const t0 = Date.now();
const { page, step, find, tab, shot, finish } = await openApp(board.json, { level });
const model = board.model;
const pick = (arr, n) => arr.filter((_, i) => i % Math.max(1, Math.floor(arr.length / n)) === 0).slice(0, n);

for (const q of [...pick(model.parts.map((p) => p.name), 6), ...pick(model.nets.filter((n) => n.kind !== "unconnected").map((n) => n.name), 6), `${model.parts[0].name}.1`])
  await step(`search ${q}`, () => find(q));

// Every section of the info panel the level shows (the former sidebar tabs).
for (const name of ["Auswahlverlauf", "Netz", "Lesezeichen", "Bauteile gewählt", "Details", "Bauteile (", "Netze (", "Lagen", "Wissen", "Messen", "Fehlersuche"])
  await step(`section ${name}`, async () => {
    if (await page.locator(".info-section .section-head", { hasText: name }).count()) await tab(name);
  });

if (level === "workshop")
  await step("guides", async () => {
    await tab("Fehlersuche");
    const options = await page.locator(".diag-pick select option").evaluateAll((os) => os.map((o) => o.value));
    for (const v of options) {
      await page.locator(".diag-pick select").selectOption(v);
      await page.waitForTimeout(200);
    }
  });

for (const k of ["Space", "b", "r", "f", "+", "-", "Space", "b"])
  await step(`key ${k}`, async () => {
    await page.locator(".board-view").first().click({ position: { x: 5, y: 5 } });
    await page.keyboard.press(k);
    await page.waitForTimeout(250);
  });
await step("click board", async () => {
  const b = await page.locator(".board-view").first().boundingBox();
  for (const [x, y] of [
    [0.5, 0.5],
    [0.3, 0.4],
    [0.6, 0.7],
  ]) {
    await page.mouse.click(b.x + b.width * x, b.y + b.height * y);
    await page.waitForTimeout(200);
  }
});
await step("palette", async () => {
  await page.keyboard.press("Meta+k");
  await page.waitForTimeout(300);
  await page.keyboard.type("Lese");
  await page.keyboard.press("Escape");
});
await step("settings", async () => {
  // From the palette: the toolbar carries only the view's symbols since it went FlexBV's way.
  await page.keyboard.press("Meta+k");
  await page.waitForTimeout(300);
  await page.keyboard.type("Einstellungen");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(500);
  if (!(await page.locator(".dialog, dialog[open]").count())) throw new Error("no settings dialog");
  await page.keyboard.press("Escape");
});
await step("help", async () => {
  await page.keyboard.press("?");
  await page.waitForTimeout(300);
  await page.keyboard.press("Escape");
});
await step("library", async () => {
  await page.keyboard.press("Meta+l");
  await page.waitForTimeout(600);
  await page.keyboard.press("Escape");
});
await step("bga", async () => {
  const bga = model.parts.find((p) => p.pinCount > 100);
  if (!bga) return;
  await find(bga.name);
  await tab("Details");
  const b = page.getByRole("button", { name: "BGA-Ansicht öffnen" });
  if (await b.count()) {
    await b.click();
    await page.waitForTimeout(500);
    await page.keyboard.press("Escape");
  }
});
await step("signal path", async () => {
  const n = model.nets.find((x) => x.kind === "power");
  if (!n) return;
  await find(n.name);
  const b = page.getByRole("button", { name: "Auf dem Board zeigen" });
  if (await b.count()) await b.click();
});
await shot(`sweep-${board.name}-${level}`);
console.log(`${board.name} (${level}): ${((Date.now() - t0) / 1000).toFixed(1)} s, ${model.parts.length} parts`);
await finish(board.name);
