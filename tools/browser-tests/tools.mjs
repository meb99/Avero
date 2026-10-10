// The board tool: only one tool is in use at a time (ruler, marker, drawing), clicks go to
// it, Enter finishes an area and Escape ends the tool before it clears the selection.
// Usage: node tools.mjs [board.json]
import { boardArg, openApp } from "./common.mjs";

const board = boardArg();
const { page, step, savedNotes, finish } = await openApp(board.json);

const view = page.locator(".board-view").first();
const key = async (k) => {
  await page.keyboard.press(k);
  await page.waitForTimeout(250);
};
const click = async (x, y) => {
  await view.click({ position: { x, y } });
  await page.waitForTimeout(250);
};
/** Which tool the screen shows: its hint and the drawing menu. */
const shown = async () => ({
  ruler: await page.locator(".ruler-hint").count(),
  placing: await page.locator(".placing-hint:not(.drawing-hint)").count(),
  drawing: await page.locator(".drawing-hint:not(.ruler-hint)").count(),
  menu: await page.locator(".draw-select").inputValue(),
});
const drawings = async () => (await savedNotes()).flatMap((n) => n.drawings ?? []);

await click(5, 5);

await step("one tool at a time", async () => {
  await key("l");
  let s = await shown();
  if (!s.ruler || s.menu !== "ruler") throw new Error(`L: no ruler ${JSON.stringify(s)}`);
  await key("m");
  s = await shown();
  if (s.ruler || !s.placing || s.menu !== "") throw new Error(`M kept the ruler ${JSON.stringify(s)}`);
  await page.locator(".draw-select").selectOption("line");
  await page.waitForTimeout(250);
  s = await shown();
  if (s.placing || !s.drawing || s.menu !== "line") throw new Error(`line kept the marker ${JSON.stringify(s)}`);
  await key("l");
  s = await shown();
  if (s.drawing || !s.ruler) throw new Error(`L kept the drawing ${JSON.stringify(s)}`);
  console.log("ruler → marker → line → ruler: one at a time");
});

await step("clicks go to the tool", async () => {
  // The ruler from the step before: two points, then its distance.
  await click(300, 300);
  await click(420, 360);
  const text = await page.locator(".ruler-hint strong").innerText();
  if (!/mm/.test(text)) throw new Error(`ruler shows ${text}`);
  await key("Escape");
  if ((await shown()).ruler) throw new Error("Escape kept the ruler");

  const before = (await drawings()).length;
  await page.locator(".draw-select").selectOption("line");
  await click(300, 400);
  await click(450, 420);
  await page.waitForTimeout(500);
  const lines = await drawings();
  if (lines.length !== before + 1 || lines.at(-1).kind !== "line") throw new Error(`line not drawn (${lines.length})`);
  if ((await shown()).drawing) throw new Error("the line tool stayed after its two points");

  await page.locator(".draw-select").selectOption("area");
  for (const [x, y] of [[250, 250], [350, 250], [350, 330]]) await click(x, y);
  await key("Enter");
  await page.waitForTimeout(500);
  const areas = (await drawings()).filter((d) => d.kind === "area");
  if (areas.length !== 1 || areas[0].points.length !== 3) throw new Error(`area not finished by Enter (${areas.length})`);
  console.log("ruler:", text.split("\n")[0], "| line and area drawn, Enter finishes the area");
});

await step("moving a drawing", async () => {
  const line = (await drawings()).find((d) => d.kind === "line");
  if (!line) throw new Error("no line to move");
  const move = () => page.evaluate((id) => window.dispatchEvent(new CustomEvent("avero:move-drawing", { detail: id })), line.id);
  await move();
  await page.waitForTimeout(250);
  if (!(await shown()).drawing) throw new Error("moving shows no hint");
  // Another tool ends the moving.
  await key("l");
  let s = await shown();
  if (s.drawing || !s.ruler) throw new Error(`L kept the moving ${JSON.stringify(s)}`);
  await key("Escape");
  await move();
  await page.waitForTimeout(250);
  await click(500, 200);
  await page.waitForTimeout(500);
  const moved = (await drawings()).find((d) => d.id === line.id);
  if (!moved || moved.points[0].x === line.points[0].x) throw new Error("the line did not move");
  s = await shown();
  if (s.drawing) throw new Error("moving stayed after the click");
  console.log("moving: placed by a click, ended by another tool");
});

await step("Escape ends the tool first", async () => {
  await key("m");
  if (!(await shown()).placing) throw new Error("M placed no marker");
  await key("Escape");
  const s = await shown();
  if (s.placing || s.ruler || s.drawing) throw new Error(`Escape kept a tool ${JSON.stringify(s)}`);
  console.log("Escape: marker off");
});

await finish(`tools on ${board.name}`);
