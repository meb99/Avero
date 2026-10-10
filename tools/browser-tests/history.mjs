// The selection history: ⌘← / ⌘→, the palette's Back and Forward and the mouse's side buttons
// all step through one list per board.
// Usage: node history.mjs [board.json]
import { boardArg, openApp } from "./common.mjs";

const board = boardArg();
const [a, b, c] = board.model.parts.filter((p) => p.pinCount >= 2).map((p) => p.name);
const { page, step, find, finish } = await openApp(board.json);

const title = () => page.locator(".details h2").first().innerText();
const off = () => page.evaluate(() => document.activeElement?.blur());
const key = async (k) => {
  await off();
  await page.keyboard.press(k);
  await page.waitForTimeout(400);
};
const palette = async (label) => {
  await off();
  await page.keyboard.press("Meta+k");
  await page.waitForTimeout(300);
  await page.keyboard.type(label);
  await page.waitForTimeout(300);
  await page.keyboard.press("Enter");
  await page.waitForTimeout(400);
};
const expect = async (want, after) => {
  const got = await title();
  if (got !== want) throw new Error(`${after}: shows ${got}, not ${want}`);
};

await step("keys and palette share one history", async () => {
  await find(a);
  await find(b);
  await find(c);
  await key("Meta+ArrowLeft");
  await expect(b, "⌘←");
  await palette("Vor zur nächsten Auswahl");
  await expect(c, "⌘← then palette Forward");
  await palette("Zurück zur vorigen Auswahl");
  await expect(b, "palette Back");
  await key("Meta+ArrowLeft");
  await expect(a, "palette Back then ⌘←");
  await key("Meta+ArrowRight");
  await expect(b, "⌘→");
  console.log(`history: ${a} ${b} ${c}, ⌘← and the palette step through the same list`);
});
await step("a new selection drops what lay ahead", async () => {
  // At b with c ahead: picking a makes it the newest, c is gone.
  await find(a);
  await palette("Vor zur nächsten Auswahl");
  await expect(a, "Forward after a new selection");
  await key("Meta+ArrowLeft");
  await expect(b, "⌘← after a new selection");
  console.log("a new selection cuts off the forward list");
});
await finish(`history on ${board.name}`);
