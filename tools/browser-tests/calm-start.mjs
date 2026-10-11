// A calm start, as in FlexBV: an opened board has the window (the sidebar folded until the
// first selection), a right-click looks a part (body) or a net (pin) up in the schematic,
// a middle-click turns the board over.
// Usage: node calm-start.mjs [board.json]
import { boardArg, openApp } from "./common.mjs";

const board = boardArg();
const two = board.model.parts.findIndex((p) => p.pinCount === 2 && Math.max(p.bounds.maxX - p.bounds.minX, p.bounds.maxY - p.bounds.minY) > 60);
const part = board.model.parts[two].name;
const pin = board.model.pins.find((p) => p.part === two);
const net = board.model.nets[pin.net].name;
const { page, step, find, shot, finish } = await openApp(board.json, { viewport: { width: 1400, height: 860 } });

const view = page.locator(".board-view").first();
const title = () => page.locator(".details h2").first().innerText();
const rightClickCenter = async () => {
  await page.evaluate(() => document.activeElement?.blur());
  await page.keyboard.press("Escape");
  await page.waitForTimeout(200);
  const box = await view.boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { button: "right" });
  await page.waitForTimeout(500);
};

await step("the board has the window", async () => {
  if (!(await page.locator(".sidebar.collapsed").count())) throw new Error("sidebar not folded after opening");
  const box = await view.boundingBox();
  const share = box.width / 1400;
  if (share < 0.9) throw new Error(`board takes ${Math.round(share * 100)} % of the width`);
  await shot("calm-start");
  console.log(`opened: sidebar folded, board ${Math.round(share * 100)} % of the width`);
});
await step("the first selection unfolds the sidebar", async () => {
  await find(part);
  if (await page.locator(".sidebar.collapsed").count()) throw new Error("sidebar still folded after selecting");
  if ((await title()) !== part) throw new Error(`details show ${await title()}`);
  console.log("selected:", part, "– sidebar open");
});
await step("right-click on a body finds the part", async () => {
  await rightClickCenter();
  if ((await title()) !== part) throw new Error(`right-click on ${part} selected ${await title()}`);
  // The mocked app has no schematic: it says how to open one.
  const toast = await page.locator(".status-message").first().innerText().catch(() => "");
  if (!/⌘E/.test(toast)) throw new Error(`no hint without schematic (${toast})`);
});
await step("right-click on a pin finds its net", async () => {
  await find(`${part}.${pin.number}`);
  await rightClickCenter();
  if ((await title()) !== net) throw new Error(`right-click on ${part}.${pin.number} selected ${await title()}, not ${net}`);
  console.log(`right-click: body → ${part}, pin → ${net}`);
});
await step("middle-click flips the board", async () => {
  const side = () => page.locator(".status-side").first().innerText();
  const before = await side();
  const box = await view.boundingBox();
  await page.mouse.click(box.x + 20, box.y + box.height - 20, { button: "middle" });
  await page.waitForTimeout(400);
  if ((await side()) === before) throw new Error(`middle-click left the board on ${before}`);
  await page.mouse.click(box.x + 20, box.y + box.height - 20, { button: "middle" });
  await page.waitForTimeout(400);
  console.log("middle-click:", before, "→ other side → back");
});
await step("right-click shows a hidden schematic", async () => {
  // The demo board comes with its schematic; ⌘E puts it away, a right-click brings it back.
  await page.keyboard.press("Meta+k");
  await page.waitForTimeout(300);
  await page.keyboard.type("Demo-Board öffnen");
  await page.keyboard.press("Enter");
  await page.waitForSelector(".schematic-pane .schematic-doc", { timeout: 20000 });
  await page.waitForTimeout(1500);
  const shown = () => page.locator(".schematic-pane").first().evaluate((el) => getComputedStyle(el).display !== "none");
  if (!(await shown())) throw new Error("demo schematic not shown");
  await page.evaluate(() => document.activeElement?.blur());
  await page.keyboard.press("Meta+e");
  await page.waitForTimeout(400);
  if (await shown()) throw new Error("⌘E did not put the schematic away");
  await find(part);
  await rightClickCenter();
  if (!(await shown())) throw new Error("right-click did not show the schematic");
  await shot("calm-start-schematic");
  console.log("right-click brought the schematic back");
});
await finish(`calm start on ${board.name}`);
