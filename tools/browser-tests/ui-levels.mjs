// The two interface levels side by side: screenshots of "Ansehen" and "Werkstatt" with a
// part selected, the controls and tabs each shows, and that the level chosen last is kept.
// Usage: node ui-levels.mjs [board.json] [part]
import { boardArg, openApp } from "./common.mjs";

const board = boardArg();
const part = process.argv[3] ?? board.model.parts.find((p) => p.pinCount >= 8)?.name ?? board.model.parts[0].name;
const { page, step, find, shot, finish } = await openApp(board.json, { level: "view", viewport: { width: 1600, height: 900 } });

const look = async (level) => {
  await shot(`ui-${level}-board`);
  await find(part);
  await shot(`ui-${level}-part`);
  console.log(level, "| toolbar controls:", await page.locator(".toolbar button, .toolbar select").count(), "| tabs:", (await page.locator(".sidebar [role=tab]").allInnerTexts()).join(", "));
  console.log(level, "| part details:", (await page.locator(".details h3, .details summary").allInnerTexts()).filter(Boolean).join(" | "));
  await page.keyboard.press("Escape");
};
await step("view", () => look("view"));
await step("workshop", async () => {
  await page.locator(".ui-level button", { hasText: "Werkstatt" }).click();
  await page.waitForTimeout(500);
  await look("workshop");
});
await step("lean net", async () => {
  // "Ansehen" shows no empty measuring fields or note buttons for a net without readings.
  await page.locator(".ui-level button", { hasText: "Ansehen" }).click();
  await find(board.model.nets.find((n) => n.kind === "power")?.name ?? board.model.nets[0].name);
  if ((await page.locator(".details .bound-notes, .details .measure-table").count()) > 0) throw new Error("workshop fields in Ansehen");
  await shot("ui-view-net");
});
await step("history", async () => {
  // ⌘← / ⌘→ go back and forth between the last selections.
  const net = board.model.nets.find((n) => n.kind === "power")?.name ?? board.model.nets[0].name;
  await find(part);
  await find(net);
  const title = () => page.locator(".details h2").first().innerText();
  await page.keyboard.press("Meta+ArrowLeft");
  await page.waitForTimeout(300);
  if ((await title()) !== part) throw new Error(`back: ${await title()}`);
  await page.keyboard.press("Meta+ArrowRight");
  await page.waitForTimeout(300);
  if ((await title()) !== net) throw new Error(`forward: ${await title()}`);
  console.log("history: back and forward ok");
});
await step("kept", async () => {
  await page.locator(".ui-level button", { hasText: "Ansehen" }).click();
  await page.waitForTimeout(300);
  const stored = await page.evaluate(() => localStorage.getItem("avero.settings.v1"));
  if (!stored?.includes('"uiLevel":"view"')) throw new Error(`level not kept: ${stored}`);
});
await finish(`ui levels on ${board.name}`);
