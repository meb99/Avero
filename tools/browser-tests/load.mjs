// Loading does its work once: a board's geometry goes to the graphics card once per board
// view, and once more when another tab's board takes its place. (The dev server mounts every
// view twice, React's StrictMode, so there it is twice per view.) Before 0.9.49 a new view
// uploaded its board a second time right after the first.
// Usage: node load.mjs [board.json]
import { boardArg, openApp } from "./common.mjs";

const board = boardArg();
const m = board.model;
// The pin geometry (four floats a pin, uploaded once per board) marks one upload of a board;
// boards with pad shapes send a second buffer of that size.
const pinBytes = m.pins.length * 16;
const perBoard = (m.pins.some((p) => p.pad && p.pad.w > 0 && p.pad.h > 0) ? 2 : 1) + (m.testPoints.length === m.pins.length ? 1 : 0);
const { page, step, finish } = await openApp(board.json, {
  files: [],
  recent: ["/x/a.cad", "/x/b.cad"],
  init: () => {
    window.__uploads = [];
    const real = WebGL2RenderingContext.prototype.bufferData;
    WebGL2RenderingContext.prototype.bufferData = function (target, data, usage) {
      if (data?.byteLength) window.__uploads.push([data.byteLength, usage]);
      return real.apply(this, arguments);
    };
  },
});
const STATIC_DRAW = 0x88e4;
const boards = async () => (await page.evaluate(() => window.__uploads)).filter(([bytes, usage]) => bytes === pinBytes && usage === STATIC_DRAW).length / perBoard;
const open = async (name) => {
  await page.evaluate(() => document.activeElement?.blur());
  await page.keyboard.press("Meta+k");
  await page.waitForTimeout(300);
  await page.keyboard.type(`Zuletzt geöffnet: ${name}`);
  await page.waitForTimeout(300);
  await page.keyboard.press("Enter");
  await page.waitForSelector(".board-view", { timeout: 30000 });
  await page.waitForTimeout(1500);
};

await step("a board is uploaded once per view", async () => {
  await open("a.cad");
  const n = await boards();
  // 1 in a build, 2 in the dev server (StrictMode); 3 was the double upload.
  if (n < 1 || n > 2) throw new Error(`the board was uploaded ${n} times on opening`);
  console.log(`opening: ${n} upload${n === 1 ? "" : "s"} of the board (${m.pins.length} pins)`);
});
await step("another tab's board is uploaded once", async () => {
  const before = await boards();
  await open("b.cad");
  const n = (await boards()) - before;
  if (n !== 1) throw new Error(`the second board was uploaded ${n} times`);
  console.log("second tab: 1 upload");
});
await step("selecting uploads no geometry", async () => {
  const before = await boards();
  const box = await page.locator(".board-view").first().boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForTimeout(500);
  if ((await boards()) !== before) throw new Error("a click uploaded the board again");
});
await finish(`load on ${board.name}`);
