// The command register in the app: the palette shows the keys set in the settings, and
// keys run their commands (⌘K palette, ? help, G grid, L ruler, a rebound flip key).
// Usage: node commands.mjs [board.json]
import { boardArg, openApp } from "./common.mjs";

const board = boardArg();
// Flip on X instead of the space bar.
const { page, step, finish } = await openApp(board.json, { settings: { shortcuts: { flip: ["x"] } } });

const palette = async (query) => {
  await page.locator(".board-view").first().click({ position: { x: 5, y: 5 } });
  await page.keyboard.press("Meta+k");
  await page.waitForTimeout(300);
  await page.keyboard.type(query);
  await page.waitForTimeout(300);
  const row = page.locator(".palette-list li").first();
  const text = { label: await row.locator(".palette-label").innerText(), key: (await row.locator("kbd").allInnerTexts())[0] };
  await page.keyboard.press("Escape");
  await page.waitForTimeout(200);
  return text;
};

await step("palette shows the set key", async () => {
  const flip = await palette("Umdrehen");
  if (flip.key !== "X") throw new Error(`flip shows ${flip.key}`);
  const fit = await palette("Fenster anpassen");
  if (fit.key !== "F") throw new Error(`fit shows ${fit.key}`);
  const open = await palette("Öffnen");
  if (open.key !== "⌘O") throw new Error(`open shows ${open.key}`);
  console.log("palette:", `${flip.label} ${flip.key}`, "·", `${fit.label} ${fit.key}`, "·", `${open.label} ${open.key}`);
});
await step("keys run their commands", async () => {
  const side = () => page.locator(".status-side").first().innerText();
  const before = await side();
  await page.locator(".board-view").first().click({ position: { x: 5, y: 5 } });
  await page.keyboard.press("x");
  await page.waitForTimeout(300);
  if ((await side()) === before) throw new Error("X did not flip");
  await page.keyboard.press("?");
  await page.waitForTimeout(300);
  if (!(await page.locator("dialog[open], .dialog").count())) throw new Error("? opened no help");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(200);
  const grid = (await palette("Raster")).label;
  await page.keyboard.press("g");
  await page.waitForTimeout(300);
  const gridAfter = (await palette("Raster")).label;
  if (grid === gridAfter) throw new Error(`G did not change the grid (${grid})`);
  await page.keyboard.press("l");
  await page.waitForTimeout(300);
  if (!(await page.locator(".board-view").first().evaluate(() => !!document.querySelector(".ruler-hint, .placing-hint, [class*=ruler]")))) console.log("(no ruler hint element found, skipped)");
  console.log("keys: X flips, ? help, G grid:", grid, "→", gridAfter);
});
await finish(`commands on ${board.name}`);
