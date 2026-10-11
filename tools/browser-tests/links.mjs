// Linked nets in levels, as FlexBV's: the symbol shows the level and goes 2 → 3 → 1 → 2; a net
// behind a coil or 0 Ω part shows under "Verbunden" in its colour at level 2.
// Usage: node links.mjs [board.json]
import { boardArg, openApp } from "./common.mjs";

const board = boardArg();
// A net on a two-pin coil (the demo's L3000 joins PP_VCORE_SW and PP_VCORE).
const coil = board.model.parts.findIndex((p) => /^L\d/.test(p.name) && p.pinCount === 2);
const pins = board.model.pins.filter((p) => p.part === coil);
const net = coil >= 0 ? board.model.nets[pins[0].net].name : null;
const other = coil >= 0 ? board.model.nets[pins[1].net].name : null;
const { page, step, find, shot, finish } = await openApp(board.json, { viewport: { width: 1400, height: 860 } });

const level = () => page.locator(".toolbar .link-depth-n").innerText();
await step("the symbol goes through the levels", async () => {
  if ((await level()) !== "2") throw new Error(`starts at ${await level()}`);
  const seen = [];
  for (let i = 0; i < 3; i++) {
    await page.locator(".toolbar .link-depth").click();
    await page.waitForTimeout(200);
    seen.push(await level());
  }
  if (seen.join() !== "3,1,2") throw new Error(`levels ${seen.join()}`);
  console.log("levels: 2 →", seen.join(" → "));
});
await step("a net behind a coil is linked", async () => {
  if (!net) return console.log("(no two-pin coil on this board, skipped)");
  await find(net);
  const chips = await page.locator(".info-section[data-section=net] .info-chip").allInnerTexts();
  if (!chips.some((c) => c.includes(other))) throw new Error(`${net}: linked ${chips.join(", ")}, not ${other}`);
  await shot("links");
  console.log(`${net} linked to ${other} through ${board.model.parts[coil].name}`);
});
await finish(`links on ${board.name}`);
