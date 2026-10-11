// Tabs: three boards opened from "Zuletzt geöffnet", switching keeps each tab's selection,
// a file already open goes to its tab, closing the active tab makes its neighbour active.
// Usage: node tabs.mjs [board.json]
import { boardArg, openApp } from "./common.mjs";

const board = boardArg();
const part = board.model.parts.find((p) => p.pinCount >= 8)?.name ?? board.model.parts[0].name;
const net = board.model.nets.find((n) => n.kind === "power")?.name ?? board.model.nets[0].name;
const { page, step, find, shot, finish } = await openApp(board.json, { files: [], recent: ["/x/a.cad", "/x/b.cad", "/x/c.cad"] });
const openRecent = async (name) => {
  await page.keyboard.press("Meta+k");
  await page.waitForTimeout(300);
  await page.keyboard.type(`Zuletzt geöffnet: ${name}`);
  await page.waitForTimeout(300);
  await page.keyboard.press("Enter");
  await page.waitForTimeout(800);
};

const tabs = () => page.locator(".tab-bar [role=tab]").allInnerTexts();
// What is selected, as the status bar names it (FlexBV's way).
const title = () => page.locator(".status-selection").first().innerText();
const activeName = () => page.locator(".tab-bar [aria-selected=true]").first().innerText();

await step("three tabs", async () => {
  await openRecent("a.cad");
  await openRecent("b.cad");
  await openRecent("c.cad");
  // Already open: goes to its tab instead of a fourth one.
  await openRecent("b.cad");
  if (!(await activeName()).startsWith("b")) throw new Error(`b.cad again went to ${await activeName()}`);
  await openRecent("c.cad");
  const names = (await tabs()).map((s) => s.trim().split("\n")[0]);
  if (names.length !== 3) throw new Error(`tabs: ${names.join(", ")}`);
  console.log("tabs:", names.join(", "), "| active:", (await activeName()).split("\n")[0]);
});
await step("selection per tab", async () => {
  await page.keyboard.press("Meta+1");
  await page.waitForTimeout(400);
  await find(part);
  await page.keyboard.press("Meta+2");
  await page.waitForTimeout(400);
  await find(net);
  await page.keyboard.press("Meta+1");
  await page.waitForTimeout(500);
  if ((await title()) !== part) throw new Error(`tab 1 shows ${await title()}, not ${part}`);
  await page.keyboard.press("Meta+2");
  await page.waitForTimeout(500);
  if ((await title()) !== net) throw new Error(`tab 2 shows ${await title()}, not ${net}`);
  await page.keyboard.press("Control+Tab");
  await page.waitForTimeout(400);
  if (!(await activeName()).startsWith("c")) throw new Error(`⌃⇥ went to ${await activeName()}`);
  console.log("selection kept per tab, ⌃⇥ cycles");
});
await step("close active", async () => {
  // c is active and last: closing it makes b active, which still shows its net.
  await page.locator(".tab-bar [aria-selected=true] .tab-close").first().click();
  await page.waitForTimeout(600);
  const left = (await tabs()).length;
  if (left !== 2) throw new Error(`${left} tabs after closing`);
  if (!(await activeName()).startsWith("b")) throw new Error(`active after closing: ${await activeName()}`);
  if ((await title()) !== net) throw new Error(`b shows ${await title()}`);
  await shot("tabs");
  console.log("closing the active tab makes its neighbour active");
});
await finish(`tabs on ${board.name}`);
