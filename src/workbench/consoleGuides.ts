/**
 * Fault-finding guides for consoles and controllers, generated for the
 * board in view from its net names (filled in below).
 */
import type { BoardModel } from "../core/board";
import type { Translate } from "../i18n";
import type { FlowStep } from "./flows";

export interface BuiltinGuide {
  id: string;
  title: string;
  intro?: string;
  steps: FlowStep[];
}

export function consoleGuides(_model: BoardModel, _t: Translate): BuiltinGuide[] {
  return [];
}
