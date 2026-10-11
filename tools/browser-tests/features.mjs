// The repair features on one board, with screenshots: jumper plan (F43), BGA view (F42),
// explained hints (F37) and the repair chronicle (F54). Targets are picked from the board;
// a repair case with a short and two work steps is given as the board's notes.
// Usage: node features.mjs [board.json]
import { boardArg, openApp } from "./common.mjs";

const board = boardArg();
const m = board.model;
const kind = (net) => m.nets[net].kind;
const ground = m.nets.findIndex((n) => n.kind === "ground");

// A pin of a part with a few pins, on a signal or power net another part on its side shares.
const jumperPin = m.pins.findIndex((p, i) => {
  const part = m.parts[p.part];
  if (part.pinCount < 4 || kind(p.net) === "ground" || kind(p.net) === "unconnected") return false;
  return m.nets[p.net].pins.some((j) => j !== i && m.pins[j].part !== p.part && m.pins[j].side === p.side);
});
// A ball grid.
const bga = m.parts.find((p) => p.pinCount >= 16 && m.pins.slice(p.firstPin, p.firstPin + p.pinCount).filter((x) => /^[A-Z]{1,3}\d{1,3}$/.test(x.number)).length >= 0.8 * p.pinCount);
// A rail with a capacitor to ground on it: the short of the repair case.
const capOn = (net) =>
  m.nets[net].pins
    .map((i) => m.pins[i].part)
    .find((pi) => /^C/i.test(m.parts[pi].name) && m.pins.slice(m.parts[pi].firstPin, m.parts[pi].firstPin + m.parts[pi].pinCount).some((x) => x.net === ground));
const rail = m.nets.findIndex((n, i) => n.kind === "power" && capOn(i) !== undefined);
const railName = m.nets[rail]?.name;
const cap = rail >= 0 ? m.parts[capOn(rail)].name : undefined;

const iso = (min) => new Date(Date.UTC(2026, 9, 7, 8, min)).toISOString();
const off = { power: "off" };
const notes = railName && {
  version: 1,
  name: board.name,
  notes: "",
  activeCase: "c1",
  updated: iso(0),
  reference: { [railName]: { resistance: 4500, diode: 0.41, at: { resistance: iso(1), diode: iso(1) }, conds: { resistance: off, diode: off } } },
  cases: [
    {
      id: "c1",
      title: "Kein Bild",
      created: iso(2),
      notes: "",
      conditions: off,
      readings: {
        [railName]: {
          resistance: 4380,
          at: { resistance: iso(30) },
          conds: { resistance: off },
          history: [{ at: iso(10), resistance: 0.6, cond: off }],
        },
      },
      steps: [
        { id: "s1", at: iso(20), action: "removed", target: cap, nets: [railName, m.nets[ground].name], note: `${cap} abgelöst` },
        { id: "s2", at: iso(25), action: "replaced", target: cap, nets: [railName, m.nets[ground].name], result: "ok" },
      ],
    },
  ],
};
// A second net with a short now, for the hints.
const shorted = m.nets.findIndex((n, i) => i !== rail && n.kind === "power" && capOn(i) !== undefined);
if (notes && shorted >= 0)
  notes.cases[0].readings[m.nets[shorted].name] = { resistance: 0.7, diode: 0.003, at: { resistance: iso(40), diode: iso(40) }, conds: { resistance: off, diode: off } };

const { page, step, find, tab, shot, savedNotes, finish } = await openApp(board.json, { notes });

if (jumperPin >= 0)
  await step("jumper plan", async () => {
    const p = m.pins[jumperPin];
    await find(m.parts[p.part].name);
    await tab("Details");
    await page
      .locator(".pin-table tr", { has: page.locator("td.mono", { hasText: new RegExp(`^${p.number}$`) }) })
      .first()
      .click();
    await page.waitForTimeout(500);
    await page.locator(".jumpers button", { hasText: "Plan" }).first().click();
    await page.locator(".jumper-plan").first().scrollIntoViewIfNeeded();
    await shot("feature-jumper", ".sidebar");
    await page.locator(".jumper-plan button", { hasText: "Jumper" }).first().click();
    await page.waitForTimeout(800);
    const drawn = (await savedNotes()).flatMap((n) => n.drawings ?? []).find((d) => d.kind === "jumper");
    if (!drawn?.plan) throw new Error("jumper drawn without its plan");
    console.log("jumper:", drawn.from, "→", drawn.to, `≈ ${drawn.plan.wireMm} mm`);
  });

if (bga)
  await step("bga view", async () => {
    await find(bga.name);
    await tab("Details");
    await page.locator("button", { hasText: "BGA-Ansicht öffnen" }).first().click();
    await page.waitForTimeout(600);
    await shot("feature-bga-top", ".bga-dialog");
    await page.locator(".bga-dialog .segmented button", { hasText: "Unteransicht" }).click();
    await shot("feature-bga-bottom", ".bga-dialog");
    await page.locator(".bga-dialog .segmented button", { hasText: "Wie auf der Platine" }).click();
    await page.locator(".bga-dialog button", { hasText: "⟳" }).click();
    await page.locator(".bga-dialog select").first().selectOption("lifted");
    await page.locator(".bga-dot").nth(3).click();
    await page.locator(".bga-side button", { hasText: "Messwerte" }).click();
    await shot("feature-bga-board", ".bga-dialog");
    console.log("bga:", await page.locator(".bga-facts").innerText());
    await page.keyboard.press("Escape");
  });

if (notes && shorted >= 0)
  await step("hints", async () => {
    await find(m.nets[shorted].name);
    await tab("Details");
    await page.locator(".net-hint-box").first().scrollIntoViewIfNeeded();
    await shot("feature-hint-net", ".sidebar");
    await tab("Fehlersuche");
    await page.waitForTimeout(400);
    await shot("feature-hint-case", ".sidebar");
  });

if (notes)
  await step("chronicle", async () => {
    await tab("Messen");
    await page.waitForTimeout(400);
    await page.locator(".chronicle").first().scrollIntoViewIfNeeded();
    await shot("feature-chronicle", ".sidebar");
    console.log("before → after:", (await page.locator(".chron-evidence tbody tr").allInnerTexts()).map((r) => r.replace(/\s+/g, " ")).join(" | "));
  });

await finish(`features on ${board.name}`);
