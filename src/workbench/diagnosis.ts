/**
 * Fault-finding guide "notebook does not power on": the usual path from the
 * adapter to the CPU, with the measuring points of the board in view.
 *
 * Points come from three sources, each named in the guide:
 * - the datasheet pins of chips whose pinout was checked against the board,
 * - rail names that state their voltage ("+3VALW" 3.3 V, "+1V8_MAIN" 1.8 V),
 * - the standard Intel power-up signals (PM_SLP_S3#, VR_PWRGD …), high in S0.
 * Nothing is guessed beyond that: a step whose points are not found says so.
 */
import type { BoardModel } from "../core/board";
import { chipFor, type ChipInfo } from "../knowledge/chips";
import { checkPinout } from "../knowledge/pinout";
import type { Value } from "./measure";

export type Expect =
  | { kind: "volts"; volts: number }
  | { kind: "range"; min: number; max: number }
  | { kind: "high" }
  /** Any real voltage: the rail is there. */
  | { kind: "present" };

export type PointSource = "datasheet" | "name" | "standard" | "schematic";

export interface DiagPoint {
  net: number;
  /** Net name as shown. */
  name: string;
  expect: Expect;
  /** What the point is, e.g. "ACIN am ISL88739A (PU301)". */
  label: string;
  source: PointSource;
}

export interface DiagStep {
  id: string;
  title: string;
  /** What to do and what it means. */
  text: string;
  /** What to check when a point of this step is wrong. */
  hint: string;
  points: DiagPoint[];
}

/** Nominal voltage a rail name states: "+3VALW" 3.3, "+1.05VS" 1.05, "+1V8_MAIN" 1.8, "+19VB" 19. */
export function railVolts(name: string): number | undefined {
  // "+3VALW", or "PP1V8_S0" / "P5V_HDMI" as Apple and console boards name rails.
  const m = /^(?:\+|PP_?|P(?=\d))?(\d+(?:\.\d+)?)V(\d+)?/i.exec(name.trim());
  if (!m) return undefined;
  const volts = m[2] ? Number(`${m[1]}.${m[2]}`) : Number(m[1]);
  // "3V" rails are 3.3 V.
  if (volts === 3 && !m[2]) return 3.3;
  return Number.isFinite(volts) && volts > 0 && volts < 60 ? volts : undefined;
}

/** Is a measured value what the point expects? */
export function judge(expect: Expect, value: Value | undefined): "ok" | "bad" | undefined {
  if (value === undefined) return undefined;
  if (value === "OL") return "bad";
  switch (expect.kind) {
    case "volts":
      return Math.abs(value - expect.volts) <= Math.max(0.1 * expect.volts, 0.05) ? "ok" : "bad";
    case "range":
      return value >= expect.min && value <= expect.max ? "ok" : "bad";
    case "high":
      return value >= 1 ? "ok" : "bad";
    case "present":
      return value >= 1 ? "ok" : "bad";
  }
}

const UNNAMED = /^(N\d+|NET\d+|UNCONNECTED|NC)$/i;

interface Ctx {
  model: BoardModel;
  used: Set<number>;
  /** Voltages the schematic draws nets with (VOLTAGE=3.3V), by net index. */
  schematicVolts?: ReadonlyMap<number, number>;
}

function point(ctx: Ctx, net: number | undefined, expect: Expect, label: string, source: PointSource): DiagPoint[] {
  if (net === undefined || ctx.used.has(net)) return [];
  const name = ctx.model.nets[net].name;
  if (UNNAMED.test(name) || ctx.model.nets[net].kind === "ground" || ctx.model.nets[net].kind === "unconnected") return [];
  ctx.used.add(net);
  // A voltage the schematic states beats one guessed from the name.
  const drawn = ctx.schematicVolts?.get(net);
  if (drawn !== undefined && drawn > 0 && (expect.kind === "volts" || expect.kind === "present"))
    return [{ net, name, expect: { kind: "volts", volts: drawn }, label, source: "schematic" }];
  return [{ net, name, expect, label, source }];
}

/** Nets whose name matches, in board order, at most `limit`. */
function netsMatching(model: BoardModel, pattern: RegExp, limit = 6): number[] {
  const out: number[] = [];
  for (let i = 0; i < model.nets.length && out.length < limit; i++) if (pattern.test(model.nets[i].name)) out.push(i);
  return out;
}

/** Rail by name, with the voltage its name states (or just "present"). */
function rails(ctx: Ctx, pattern: RegExp, label: string, limit = 6): DiagPoint[] {
  return netsMatching(ctx.model, pattern, limit).flatMap((net) => {
    const volts = railVolts(ctx.model.nets[net].name);
    return point(ctx, net, volts ? { kind: "volts", volts } : { kind: "present" }, label, volts ? "name" : "standard");
  });
}

interface FoundChip {
  part: number;
  chip: ChipInfo;
  /** Net of each datasheet pin name, when the pinout fits the board. */
  pinNet: Map<string, number>;
}

function chipsOf(model: BoardModel, kind: ChipInfo["kind"]): FoundChip[] {
  const out: FoundChip[] = [];
  model.parts.forEach((p, part) => {
    const chip = chipFor(p.device);
    if (chip?.kind !== kind) return;
    const pinNet = new Map<string, number>();
    if (chip.pinout) {
      const check = checkPinout(model, part, chip.pinout);
      for (const [pin, cp] of check.byPin) if (!pinNet.has(cp.name)) pinNet.set(cp.name, model.pins[pin].net);
    }
    out.push({ part, chip, pinNet });
  });
  return out;
}

const partName = (model: BoardModel, f: FoundChip) => `${f.chip.name} (${model.parts[f.part].name})`;

/** Nets on a chip's pins whose names match, e.g. its enable and power-good signals. */
function chipNets(model: BoardModel, f: FoundChip, pattern: RegExp): number[] {
  const p = model.parts[f.part];
  const nets = new Set<number>();
  for (let i = p.firstPin; i < p.firstPin + p.pinCount; i++) if (pattern.test(model.nets[model.pins[i].net].name)) nets.add(model.pins[i].net);
  return [...nets];
}

/** Charger pins with the values its datasheet gives. */
const CHARGER_PINS: [pin: string, expect: Expect, what: string][] = [
  ["ACIN", { kind: "range", min: 2, max: 3.5 }, "Netzteil-Erkennung"],
  ["ACOK", { kind: "high" }, "Netzteil bereit"],
  ["VDD", { kind: "volts", volts: 5 }, "Versorgung"],
  ["VDDP", { kind: "volts", volts: 5 }, "interner LDO"],
];

/** Intel power-up signals in the order they come up; all high in S0. */
const SEQUENCE: [RegExp, string][] = [
  [/^(EC_|PCH_)?RSMRST#?$/i, "Dauerspannungen gut, PCH aus dem Reset"],
  [/^(PCH_)?DPWROK$/i, "Deep-Sleep-Versorgung gut"],
  [/^(PM_)?SLP_S5#?$/i, "S5 verlassen"],
  [/^(PM_)?SLP_S4#?$/i, "S4 verlassen"],
  [/^(PM_)?SLP_S3#?$/i, "S3 verlassen – System geht an"],
  [/^SYSON$/i, "Systemspannungen an"],
  [/^SUSP#?$/i, "Suspend-Spannungen an"],
  [/^VR_ON$/i, "CPU-Spannungsregler an"],
  [/^VCCST_PWRGD$/i, "VCCST gut"],
  [/^VR_PWRGD$/i, "CPU-Kernspannung gut"],
  [/^(PCH_)?PWROK$|^PCH_PWROK$/i, "PCH Power-OK"],
  [/^SYS_PWROK$/i, "System Power-OK"],
  [/^H_CPUPWRGD$/i, "CPU Power-Good"],
];

/** The guide for the board in view. */
export function noPowerGuide(model: BoardModel, schematicVolts?: ReadonlyMap<number, number>): DiagStep[] {
  const ctx: Ctx = { model, used: new Set(), schematicVolts };
  const chargers = chipsOf(model, "charger");
  const systems = chipsOf(model, "system");
  const ecs = chipsOf(model, "ec");
  const ddrs = chipsOf(model, "ddr");
  const bucks = chipsOf(model, "buck");

  const steps: DiagStep[] = [];

  steps.push({
    id: "adapter",
    title: "Netzteil am Eingang",
    text: "Netzteil anschließen, Akku abklemmen, gegen Masse messen. Am Eingang muss die Netzteilspannung anliegen.",
    hint: "Netzteil, Ladebuchse und Kabel prüfen, dann Eingangssicherung und die Trenn-MOSFETs am Eingang.",
    points: rails(ctx, /^\+?(19|20)V_?(VIN|IN|ADP|DCIN|P\d)$|^\+?(DC_?IN|VADP|ADP_?IN|VIN|PPDCIN.*)$/i, "Netzteil-Eingang", 4).map((p) =>
      p.expect.kind === "volts" ? { ...p, expect: { kind: "range", min: p.expect.volts * 0.9, max: p.expect.volts * 1.1 } } : p,
    ),
  });

  steps.push({
    id: "charger",
    title: "Laderegler erkennt das Netzteil",
    text: "Der Laderegler prüft die Netzteilspannung über einen Teiler (ACIN) und meldet sie (ACOK); seine Versorgung kommt aus einem internen 5-V-Regler. Werte laut Datenblatt.",
    hint: "Liegt ACIN außerhalb, den Spannungsteiler am ACIN-Pin prüfen; fehlt VDD/VDDP, den Regler selbst und seine Eingangsbeschaltung (DCIN).",
    points: chargers.flatMap((f) =>
      CHARGER_PINS.flatMap(([pin, expect, what]) => point(ctx, f.pinNet.get(pin), expect, `${pin} am ${partName(model, f)} – ${what}`, "datasheet")),
    ),
  });

  steps.push({
    id: "system",
    title: "Systemspannung (B+)",
    text: "Hinter dem Laderegler liegt die Systemspannung, aus der alle Wandler gespeist werden. Sie muss vorhanden sein – je nach Laderegler etwa Netzteil- oder Akkuspannung.",
    hint: "Kurzschluss auf B+ messen (Widerstand gegen Masse); fehlt sie ohne Kurzschluss, Laderegler und seine MOSFETs prüfen.",
    points: rails(ctx, /^\+?(19|20)VB$|^\+?B\+$|^\+?VSYS$|^PPBUS_G3H$|^\+?SYS_?BUS$/i, "Systemspannung", 3).map((p) => ({ ...p, expect: { kind: "present" } })),
  });

  steps.push({
    id: "always",
    title: "Dauerspannungen (3 V / 5 V ALW) und RTC",
    text: "Mit Netzteil dauerhaft vorhanden, auch ausgeschaltet: die Versorgung von EC und Einschaltlogik. Der RTC-Zweig hängt an der Knopfzelle.",
    hint: `Fehlen 3 V/5 V: Freigabe (EN) und Eingang des Systemwandlers prüfen${systems.length ? ` – hier ${systems.map((f) => partName(model, f)).join(", ")}` : ""}; danach Lastkurzschluss auf der Schiene.`,
    points: [
      ...rails(ctx, /^\+?(3V|3\.3V|5V)(_?ALW|LP)$|^PP(3V3|5V)_(S5|G3H)$/i, "Dauerspannung", 4),
      ...systems.flatMap((f) =>
        chipNets(model, f, /(^|_)EN(_|$)|PG|PGOOD/i).flatMap((net) => point(ctx, net, { kind: "high" }, `Freigabe/Power-Good am ${partName(model, f)}`, "standard")),
      ),
      ...rails(ctx, /^\+?(RTC_?VCC|VCCRTC|RTCVCC|PPVRTC.*)$/i, "RTC (Knopfzelle)", 2).map((p) => ({ ...p, expect: { kind: "range", min: 2.5, max: 3.6 } as Expect })),
    ],
  });

  steps.push({
    id: "ec",
    title: "Embedded Controller läuft",
    text: "Der EC steuert Einschalten und Laden. Er braucht seine 3,3-V-Dauerversorgung und muss aus dem Reset sein.",
    hint: "Versorgung und Reset des EC prüfen, ebenso seinen Quarz. Läuft der EC, aber es kommt kein Einschaltsignal, ist oft die EC-Firmware (BIOS) beschädigt.",
    points: [
      ...ecs.flatMap((f) =>
        // Rails only ("+3VALW_EC"): EN_5VALW on an EC pin is an enable it drives, not its supply.
        chipNets(model, f, /^\+\d.*(ALW|VL|LP|AON|_EC)/i).flatMap((net) => {
          const volts = railVolts(model.nets[net].name);
          return point(ctx, net, volts ? { kind: "volts", volts } : { kind: "present" }, `Versorgung ${partName(model, f)}`, "name");
        }),
      ),
      // Only the EC's own reset: other resets on its pins (PCI_RST#) are low while the notebook is off.
      ...ecs.flatMap((f) => chipNets(model, f, /^EC_?RST#?$/i).flatMap((net) => point(ctx, net, { kind: "high" }, `Reset ${partName(model, f)} (High = läuft)`, "standard"))),
    ],
  });

  steps.push({
    id: "button",
    title: "Einschalttaste",
    text: "Das Einschaltsignal ist in Ruhe High und geht beim Drücken kurz auf Low. Messen, dann die Taste drücken und beobachten.",
    hint: "Kommt beim Drücken nichts an: Taste, Flexkabel und Stecker prüfen; kommt es am EC an, aber nicht am PCH, liegt es am EC.",
    points: netsMatching(model, /^(PBTN_OUT#?|PM_PWRBTN.*|PWR_?BTN.*|PWRSW.*|NBSWON.*|ON_?OFF.*|POWER_?BTN.*)$/i, 3).flatMap((net) =>
      point(ctx, net, { kind: "high" }, "Einschaltsignal (Ruhe: High)", "standard"),
    ),
  });

  steps.push({
    id: "sequence",
    title: "Einschaltsequenz",
    text: "Nach dem Drücken kommen diese Signale der Reihe nach auf High (eingeschaltet, S0). Das erste, das Low bleibt, zeigt, wo die Sequenz hängt.",
    hint: "Beim ersten fehlenden Signal ansetzen: die Spannung, die es freigibt, und den Baustein, der es erzeugt.",
    points: SEQUENCE.flatMap(([pattern, what]) => netsMatching(model, pattern, 1).flatMap((net) => point(ctx, net, { kind: "high" }, what, "standard"))),
  });

  steps.push({
    id: "memory",
    title: "Speicherversorgung",
    text: "VDDQ versorgt den Arbeitsspeicher, VTT und VTTREF liegen bei der halben VDDQ (laut Datenblatt).",
    hint: "Fehlt VDDQ: Freigaben S3/S5 und Eingang des Speicherreglers prüfen, dann Kurzschluss auf VDDQ.",
    points: ddrs.flatMap((f) => [
      ...(["VDDQ", "VTT", "VTTREF"] as const).flatMap((pin) => {
        const net = f.pinNet.get(pin);
        if (net === undefined) return [];
        const volts = railVolts(model.nets[net].name);
        return point(ctx, net, volts ? { kind: "volts", volts } : { kind: "present" }, `${pin} am ${partName(model, f)}`, volts ? "name" : "datasheet");
      }),
      ...(["S3", "S5", "PGOOD"] as const).flatMap((pin) => point(ctx, f.pinNet.get(pin), { kind: "high" }, `${pin} am ${partName(model, f)}`, "datasheet")),
    ]),
  });

  steps.push({
    id: "converters",
    title: "Weitere Spannungswandler",
    text: "Freigabe (EN) und Power-Good (PG) der Abwärtswandler: eingeschaltet High.",
    hint: "Ist EN High, aber PG Low: Ausgang des Wandlers auf Kurzschluss prüfen, dann den Wandler selbst.",
    points: bucks.flatMap((f) =>
      (["EN", "PG"] as const).flatMap((pin) => point(ctx, f.pinNet.get(pin), { kind: "high" }, `${pin} am ${partName(model, f)}`, "datasheet")),
    ),
  });

  return steps;
}
