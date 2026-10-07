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
await step("kept", async () => {
  await page.locator(".ui-level button", { hasText: "Ansehen" }).click();
  await page.waitForTimeout(300);
  const stored = await page.evaluate(() => localStorage.getItem("avero.settings.v1"));
  if (!stored?.includes('"uiLevel":"view"')) throw new Error(`level not kept: ${stored}`);
});
await finish(`ui levels on ${board.name}`);
