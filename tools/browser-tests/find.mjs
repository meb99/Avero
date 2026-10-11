// The search for part / net (⌘F), as in FlexBV: parts and/or nets, substring, prefix or whole
// name, a click shows a hit and keeps the dialog, the second entry adds a part to the parts
// selected, Enter takes the hit and closes.
// Usage: node find.mjs [board.json]
import { boardArg, openApp } from "./common.mjs";

const board = boardArg();
const names = board.model.parts.map((p) => p.name);
// A part name that is the start of others (C30 → C3000, C3001 …), and two whole names.
const stem = names.map((n) => n.slice(0, -2)).find((s) => s.length >= 2 && names.filter((n) => n.startsWith(s)).length >= 3);
const [first, second] = names.filter((n) => n.startsWith(stem));
const { page, step, shot, finish } = await openApp(board.json, { viewport: { width: 1400, height: 860 } });

const hits = (column) => page.locator(`.find-column:nth-child(${column + 1}) .find-hit`).allInnerTexts();
const type = async (column, text) => {
  await page.locator(`#find-${column}`).fill(text);
  await page.waitForTimeout(250);
};
const option = (label) => page.locator(".find-options label", { hasText: label }).locator("input").first();

await step("opens from the toolbar", async () => {
  await page.locator(".toolbar button[aria-label^='Bauteil oder Netz suchen']").click();
  await page.waitForSelector(".find-dialog #find-0", { timeout: 5000 });
});
await step("modes and kinds", async () => {
  await option("Teilwort").check();
  await type(0, stem);
  const some = await hits(0);
  if (some.length < 3) throw new Error(`substring ${stem}: ${some.join(", ")}`);
  await option("Ganzer Name").check();
  if ((await hits(0)).length !== 0) throw new Error(`whole name ${stem} found ${await hits(0)}`);
  await type(0, first);
  if ((await hits(0)).length !== 1) throw new Error(`whole name ${first}: ${await hits(0)}`);
  await option("Bauteile").uncheck();
  if ((await hits(0)).length !== 0) throw new Error("parts left out, still found");
  await option("Bauteile").check();
  await option("Teilwort").check();
  console.log(`substring ${stem}: ${some.length} hits, whole name ${first}: 1, without parts: 0`);
});
await step("a click shows the hit, the second entry adds a part", async () => {
  await type(0, first);
  await page.locator(".find-column:nth-child(1) .find-hit", { hasText: first }).first().click();
  await page.waitForTimeout(400);
  if ((await page.locator(".status-selection").innerText()) !== first) throw new Error("click did not select");
  if (!(await page.locator(".find-dialog").count())) throw new Error("click closed the dialog");
  await type(1, second);
  await page.locator(".find-column:nth-child(2) .find-hit", { hasText: second }).first().click();
  await page.waitForTimeout(400);
  await shot("find");
  const head = await page.locator(".info-section .section-head", { hasText: "Bauteile gewählt" }).first().innerText();
  if (!head.includes("(2)")) throw new Error(`second entry: ${head}`);
  console.log(`${first} selected by a click, ${second} added: ${head}`);
});
await step("Esc closes at once, also with text typed", async () => {
  await type(0, "ZZZ_NOTHING");
  await page.locator("#find-0").press("Escape");
  await page.waitForTimeout(300);
  if (await page.locator(".find-dialog").count()) throw new Error("Esc left the dialog open");
  await page.locator(".toolbar button[aria-label^='Bauteil oder Netz suchen']").click();
  await page.waitForSelector(".find-dialog #find-0", { timeout: 5000 });
});
await step("Enter takes the hit and closes", async () => {
  await type(0, second);
  await page.locator("#find-0").press("Enter");
  await page.waitForTimeout(400);
  if (await page.locator(".find-dialog").count()) throw new Error("Enter left the dialog open");
  if ((await page.locator(".status-selection").innerText()) !== second) throw new Error("Enter did not select");
});
await finish(`find on ${board.name}`);
