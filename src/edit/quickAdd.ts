import type { LaneCell, Layout, Row, Who } from "../content/schema";
import { splitTableRow } from "../import/markdown";
import { autoStatusRow } from "./model";

/**
 * "Paste rows": turn plain lines into rows, so a script typed in Notes, a
 * message or a spreadsheet can be dropped in at once.
 *
 *   two-lane:    Trigger | PF | PM
 *   single-lane: Trigger | Action | Who
 *
 * Columns are separated by "|" or a tab. Text in double quotes (or **bold**)
 * is the callout. A lone "-" marks a standing lane. A leading row number
 * column and Markdown header/separator lines are ignored. Nothing is invented:
 * cells left out stay empty and the row shows as "to fill".
 */
export interface QuickAddResult {
  rows: Row[];
  skipped: Array<{ line: number; text: string; reason: string }>;
}

const QUOTED = /["“]([^"“”]+)["”]/g;
const BOLD = /\*\*(.+?)\*\*/g;
const STANDING = /^[-–—]$/;

export function parseCell(text: string): LaneCell {
  const t = text.trim();
  if (STANDING.test(t)) return { action: "", standing: true };
  const callouts: string[] = [];
  const action = t
    .replace(BOLD, (_m, c: string) => (callouts.push(c.trim()), " "))
    .replace(QUOTED, (_m, c: string) => (callouts.push(c.trim()), " "))
    .replace(/\s+/g, " ")
    .trim();
  return callouts.length ? { action, callout: callouts.join(" ") } : { action };
}

const norm = (s: string) => s.replace(/\*/g, "").trim().toLowerCase();
const HEADERS = new Set(["#|trigger|pf|pm", "trigger|pf|pm", "#|trigger|action|who", "trigger|action|who", "trigger|action"]);
const isSeparator = (line: string) => /-/.test(line) && /^[\s|:\-]+$/.test(line);
const looksLikeNumber = (s: string) => s === "#" || /^\d+[A-Za-z]?(\.\d+)?\.?$/.test(s);

function parseWho(raw: string): Who | null {
  const w = norm(raw).toUpperCase();
  if (w === "") return "UNASSIGNED";
  if (w === "PF" || w === "PM" || w === "BOTH" || w === "UNASSIGNED") return w;
  return null;
}

export function parseQuickRows(text: string, layout: Layout, makeId: () => string): QuickAddResult {
  const rows: Row[] = [];
  const skipped: QuickAddResult["skipped"] = [];
  text.split(/\r?\n/).forEach((raw, i) => {
    const line = raw.trim();
    if (!line || isSeparator(line)) return;
    let cells = line.includes("\t") ? line.split("\t").map((c) => c.trim()) : line.includes("|") ? splitTableRow(line) : [line];
    if (HEADERS.has(cells.map(norm).join("|"))) return;
    if (cells.length === 4 && looksLikeNumber(cells[0]!)) cells = cells.slice(1);
    if (cells.length > 3) {
      skipped.push({ line: i + 1, text: raw, reason: `too many columns (${cells.length}); expected at most 3` });
      return;
    }
    const [trigger = "", second = "", third = ""] = cells;
    if (layout === "two-lane") {
      rows.push(autoStatusRow(layout, { id: makeId(), trigger, pf: parseCell(second), pm: parseCell(third), status: "ok" }));
    } else {
      const who = parseWho(third);
      if (who === null) {
        skipped.push({ line: i + 1, text: raw, reason: `"${third}" is not PF, PM or BOTH` });
        return;
      }
      const cell = parseCell(second);
      const row: Row = { id: makeId(), trigger, action: cell.action, who, status: "ok" };
      if (cell.callout) row.callout = cell.callout;
      rows.push(autoStatusRow(layout, row));
    }
  });
  return { rows, skipped };
}
