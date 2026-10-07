/**
 * A ball template to print 1:1 (F42): pads where the board file puts them, A1 marked, the
 * direction it is seen from and a scale bar to check the print against. Only made from
 * dimensions the file gives consistently – never from a guessed pitch.
 */
import { ballPitch, ballPlaces, cornerBall, type BallGrid } from "../core/bga";
import type { BoardModel } from "../core/board";

export interface TemplateText {
  title: string;
  /** "Seen from the top of the board", … */
  direction: string;
  pitch: string;
  scale: string;
  check: string;
}

const MM = 0.0254;
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Why no template can be made, or null when it can. */
export function templateBlocked(model: BoardModel, part: number, grid: BallGrid): "estimated" | "pitch" | null {
  if (model.parts[part].estimated) return "estimated";
  const pitch = ballPitch(model, grid);
  if (!pitch || !pitch.consistent) return "pitch";
  return null;
}

/**
 * The template as SVG in millimetres. `mirror` shows the balls of the chip from below
 * instead of the pads on the board from above; `quarterTurns` turns it like the dialog.
 */
export function bgaTemplateSvg(model: BoardModel, grid: BallGrid, mirror: boolean, quarterTurns: number, text: TemplateText): string {
  const places = ballPlaces(model, grid, "board", quarterTurns).map((b) => ({ ...b, x: (mirror ? -b.x : b.x) * MM, y: b.y * MM }));
  const a1 = cornerBall(grid);
  const minX = Math.min(...places.map((b) => b.x));
  const maxX = Math.max(...places.map((b) => b.x));
  const minY = Math.min(...places.map((b) => b.y));
  const maxY = Math.max(...places.map((b) => b.y));
  const margin = 12;
  const head = 22;
  const width = Math.max(maxX - minX + 2 * margin, 70);
  const height = maxY - minY + 2 * margin + head + 14;
  const ox = (width - (maxX - minX)) / 2 - minX;
  const oy = head + margin - minY;
  const out: string[] = [];
  out.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width.toFixed(2)}mm" height="${height.toFixed(2)}mm" viewBox="0 0 ${width.toFixed(3)} ${height.toFixed(3)}" font-family="Helvetica, Arial, sans-serif">`,
    `<rect width="100%" height="100%" fill="#fff"/>`,
    `<text x="4" y="6" font-size="4" font-weight="700">${esc(text.title)}</text>`,
    `<text x="4" y="11" font-size="2.8">${esc(text.direction)}</text>`,
    `<text x="4" y="15.5" font-size="2.8">${esc(text.pitch)}</text>`,
  );
  // Body outline from the ball field, half a pitch out.
  const pitch = ballPitch(model, grid);
  const pad = ((pitch?.col ?? 40) * MM) / 2 + 0.6;
  out.push(
    `<rect x="${(minX + ox - pad).toFixed(3)}" y="${(minY + oy - pad).toFixed(3)}" width="${(maxX - minX + 2 * pad).toFixed(3)}" height="${(maxY - minY + 2 * pad).toFixed(3)}" fill="none" stroke="#000" stroke-width="0.2"/>`,
  );
  for (const b of places) {
    const r = Math.max(model.pins[b.pin].radius * MM, 0.1);
    const isA1 = b.pin === a1;
    out.push(`<circle cx="${(b.x + ox).toFixed(3)}" cy="${(b.y + oy).toFixed(3)}" r="${r.toFixed(3)}" fill="${isA1 ? "#000" : "none"}" stroke="#000" stroke-width="0.08"/>`);
  }
  if (a1 !== undefined) {
    const b = places.find((p) => p.pin === a1)!;
    // A triangle in the corner by A1 and its name, whatever the turn or side.
    const cx = b.x + ox;
    const cy = b.y + oy;
    const dx = cx < ox + (minX + maxX) / 2 ? -1 : 1;
    const dy = cy < oy + (minY + maxY) / 2 ? -1 : 1;
    const tx = cx + dx * (pad + 0.4);
    const ty = cy + dy * (pad + 0.4);
    out.push(
      `<path d="M${tx.toFixed(3)} ${ty.toFixed(3)} l${(-dx * 2.4).toFixed(3)} 0 l${(dx * 2.4).toFixed(3)} ${(-dy * 2.4).toFixed(3)} z" fill="#000"/>`,
      `<text x="${(tx + dx * 1).toFixed(3)}" y="${(ty + dy * 3.2).toFixed(3)}" font-size="2.6" font-weight="700" text-anchor="${dx < 0 ? "end" : "start"}">${esc(model.pins[a1].number)}</text>`,
    );
  }
  // 10 mm scale bar to check the print.
  const sy = height - 7;
  out.push(
    `<line x1="4" y1="${sy}" x2="14" y2="${sy}" stroke="#000" stroke-width="0.4"/>`,
    `<line x1="4" y1="${sy - 1.5}" x2="4" y2="${sy + 1.5}" stroke="#000" stroke-width="0.3"/>`,
    `<line x1="14" y1="${sy - 1.5}" x2="14" y2="${sy + 1.5}" stroke="#000" stroke-width="0.3"/>`,
    `<text x="16" y="${sy + 1}" font-size="2.6">${esc(text.scale)}</text>`,
    `<text x="4" y="${height - 2}" font-size="2.2" fill="#444">${esc(text.check)}</text>`,
    `</svg>`,
  );
  return out.join("\n");
}
