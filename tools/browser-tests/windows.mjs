// Avero as Windows shows it: Strg is the command key, the keys read "Strg+F", the menu's
// keys (Strg+Umschalt+…, Strg+,) work in the window, tabs go with Strg+1 … 9, and the
// toolbar needs no room for the Mac's window buttons.
// Usage: node windows.mjs [board.json]
import { boardArg, openApp } from "./common.mjs";

const board = boardArg();
const part = board.model.parts.find((p) => p.pinCount >= 8)?.name ?? board.model.parts[0].name;
const { page, step, shot, finish } = await openApp(board.json, { os: "windows", files: [], recent: ["/x/a.cad", "/x/b.cad"] });
const blur = () => page.evaluate(() => document.activeElement?.blur());
const glyphs = /[⌘⌥⇧⌃]/;
const active = () => page.locator(".tab-bar [aria-selected=true]").first().innerText();

await step("Strg+K opens boards in tabs", async () => {
  for (const name of ["a.cad", "b.cad"]) {
    await blur();
    await page.keyboard.press("Control+k");
    await page.waitForTimeout(300);
    await page.keyboard.type(`Zuletzt geöffnet: ${name}`);
    await page.waitForTimeout(300);
    await page.keyboard.press("Enter");
    await page.waitForSelector(".board-view", { timeout: 20000 });
    await page.waitForTimeout(800);
  }
  if (!(await active()).startsWith("b")) throw new Error(`active ${await active()}`);
});

await step("the window is laid out for Windows", async () => {
  const os = await page.evaluate(() => document.documentElement.dataset.platform);
  if (os !== "windows") throw new Error(`platform ${os}`);
  const pad = await page.locator(".toolbar").first().evaluate((el) => getComputedStyle(el).paddingLeft);
  if (pad !== "8px") throw new Error(`toolbar keeps ${pad} for window buttons`);
  console.log("toolbar padding:", pad);
});
await step("Strg+F searches, the field names the key", async () => {
  await blur();
  await page.keyboard.press("Control+f");
  await page.waitForSelector(".find-dialog #find-0", { timeout: 5000 });
  const s = page.locator(".find-dialog #find-0");
  await s.fill(part);
  await s.press("Enter");
  await page.waitForTimeout(700);
  if (await page.locator(".find-dialog").count()) await page.keyboard.press("Escape");
  const selected = await page.locator(".status-selection").first().innerText();
  if (selected !== part) throw new Error(`Strg+F found ${selected}, not ${part}`);
  const hint = await page.locator(".toolbar [aria-label]").evaluateAll((els) => els.map((e) => e.getAttribute("title") ?? "").join(" "));
  if (glyphs.test(hint)) throw new Error(`Mac keys in the toolbar: ${hint}`);
});
await step("the palette shows Windows keys", async () => {
  await blur();
  await page.keyboard.press("Control+k");
  await page.waitForSelector(".palette-list li", { timeout: 5000 });
  const keys = await page.locator(".palette-list kbd").allInnerTexts();
  await page.keyboard.press("Escape");
  if (!keys.includes("Strg+O")) throw new Error(`no Strg+O among ${keys.slice(0, 12).join(", ")}`);
  if (keys.some((k) => glyphs.test(k))) throw new Error(`Mac keys: ${keys.filter((k) => glyphs.test(k)).join(", ")}`);
  console.log("palette keys:", keys.slice(0, 8).join(", "));
});
await step("menu keys work in the window", async () => {
  // Strg+, is the settings (on the Mac the menu bar takes ⌘,).
  await blur();
  await page.keyboard.press("Control+,");
  await page.waitForSelector(".dialog", { timeout: 5000 });
  const title = await page.locator(".dialog h2, .dialog header").first().innerText();
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  if (!/Einstellungen/.test(title)) throw new Error(`Strg+, opened ${title}`);
  // Help with the keys, all written the Windows way.
  await blur();
  await page.keyboard.press("Control+/");
  await page.waitForSelector(".dialog", { timeout: 5000 });
  const help = await page.locator(".dialog").first().innerText();
  await shot("windows-help");
  await page.keyboard.press("Escape");
  if (!help.includes("Strg+F")) throw new Error("help names no Strg+F");
  if (glyphs.test(help)) throw new Error(`Mac keys in the help: ${help.match(/.{0,20}[⌘⌥⇧⌃].{0,20}/)?.[0]}`);
  console.log("settings and help open with Strg+, and Strg+/");
});
await step("Strg+1 and Strg+2 switch tabs", async () => {
  await blur();
  await page.keyboard.press("Control+1");
  await page.waitForTimeout(400);
  const first = (await active()).split("\n")[0];
  await page.keyboard.press("Control+2");
  await page.waitForTimeout(400);
  const second = (await active()).split("\n")[0];
  if (!first.startsWith("a") || !second.startsWith("b")) throw new Error(`tabs ${first} → ${second}`);
  console.log("tabs:", first, "→", second);
});
await shot("windows");
await finish(`Windows on ${board.name}`);
