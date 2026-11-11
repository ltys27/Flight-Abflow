import type { Gate, Layout, Row, Who } from "../content/schema";

/**
 * Markdown table import (spec 6.4).
 *
 *  - `## ` headings become gates.
 *  - A table whose header is `# | Trigger | PF | PM` becomes a two-lane gate.
 *  - A table whose header is `# | Trigger | Action | Who` becomes a single-lane gate.
 *  - Bold text (`**...**`) in a cell becomes the callout; the rest is the action.
 *  - The `#` column is ignored.
 *  - Every line that could not be parsed is reported with its line number.
 *
 * The parser never invents content: cell text is kept verbatim apart from the
 * bold markers that denote a callout and surrounding whitespace.
 */

export interface UnparsedLine {
  line: number; // 1-based
  text: string;
  reason: string;
}

export interface ParsedGate {
  title: string;
  layout: Layout;
  /** Rows without ids; the caller assigns stable ids. */
  rows: Omit<Row, "id">[];
  /** 1-based line of the heading (or the table header when no heading). */
  line: number;
}

export interface MarkdownParseResult {
  gates: ParsedGate[];
  unparsed: UnparsedLine[];
}

export interface ParsedCell {
  action: string;
  callout?: string;
}

/** Split `**bold**` out of a cell as the callout. Multiple bold runs are joined with a space. */
export function splitCallout(cell: string): ParsedCell {
  const bold: string[] = [];
  const rest = cell
    .replace(/\*\*(.+?)\*\*/g, (_m, inner: string) => {
      bold.push(inner.trim());
      return " ";
    })
    .replace(/\s+/g, " ")
    .trim();
  const out: ParsedCell = { action: rest };
  if (bold.length > 0) out.callout = bold.join(" ");
  return out;
}

/** Split a pipe table line into trimmed cells, honouring `\|` escapes. */
export function splitTableRow(line: string): string[] {
  let s = line.trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|") && !s.endsWith("\\|")) s = s.slice(0, -1);
  const cells: string[] = [];
  let cur = "";
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === "\\" && s[i + 1] === "|") {
      cur += "|";
      i++;
    } else if (ch === "|") {
      cells.push(cur.trim());
      cur = "";
    } else {
      cur += ch;
    }
  }
  cells.push(cur.trim());
  return cells;
}

const norm = (s: string) => s.replace(/\*/g, "").trim().toLowerCase();

function headerLayout(cells: string[]): Layout | null {
  const h = cells.map(norm);
  if (h.length === 4 && h[0] === "#" && h[1] === "trigger" && h[2] === "pf" && h[3] === "pm") {
    return "two-lane";
  }
  if (h.length === 4 && h[0] === "#" && h[1] === "trigger" && h[2] === "action" && h[3] === "who") {
    return "single-lane";
  }
  return null;
}

const isSeparator = (line: string) => /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/.test(line);
const isTableLine = (line: string) => line.trim().startsWith("|") || line.includes("|");

function parseWho(raw: string): Who | null {
  const w = norm(raw).toUpperCase();
  if (w === "PF" || w === "PM" || w === "BOTH" || w === "UNASSIGNED") return w;
  if (w === "") return "UNASSIGNED";
  return null;
}

export function parseMarkdown(text: string): MarkdownParseResult {
  const lines = text.split(/\r?\n/);
  const gates: ParsedGate[] = [];
  const unparsed: UnparsedLine[] = [];

  let pendingTitle: { title: string; line: number } | null = null;
  let current: ParsedGate | null = null;
  let inTable = false;
  let skippingTable = false;

  const unparse = (i: number, reason: string) => {
    unparsed.push({ line: i + 1, text: lines[i] ?? "", reason });
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    const trimmed = line.trim();

    if (trimmed === "") {
      inTable = false;
      skippingTable = false;
      continue;
    }

    const heading = /^##\s+(.+?)\s*#*\s*$/.exec(trimmed);
    if (heading) {
      pendingTitle = { title: heading[1]!, line: i + 1 };
      current = null;
      inTable = false;
      skippingTable = false;
      continue;
    }

    if (!isTableLine(line)) {
      // Non-table prose is ignored unless it looks like a different heading level.
      if (/^#{1,6}\s/.test(trimmed)) continue; // top-level title / sub-sub headings
      unparse(i, "not part of a table");
      continue;
    }

    const cells = splitTableRow(line);

    if (skippingTable) {
      unparse(i, "belongs to a table with an unrecognised header");
      continue;
    }

    if (!inTable) {
      const layout = headerLayout(cells);
      if (!layout) {
        unparse(i, "table header is not `# | Trigger | PF | PM` or `# | Trigger | Action | Who`");
        skippingTable = true;
        continue;
      }
      const next = lines[i + 1] ?? "";
      if (!isSeparator(next)) {
        unparse(i, "table header is not followed by a separator line");
        continue;
      }
      const title = pendingTitle?.title ?? "";
      current = { title, layout, rows: [], line: pendingTitle?.line ?? i + 1 };
      gates.push(current);
      pendingTitle = null;
      inTable = true;
      i++; // skip separator
      continue;
    }

    if (!current) {
      unparse(i, "table row outside a table");
      continue;
    }

    if (cells.length !== 4) {
      unparse(i, `expected 4 cells, found ${cells.length}`);
      continue;
    }

    const [, trigger, c3, c4] = cells as [string, string, string, string];
    if (current.layout === "two-lane") {
      const pf = splitCallout(c3);
      const pm = splitCallout(c4);
      const row: Omit<Row, "id"> = {
        trigger,
        pf: pf.callout !== undefined ? { action: pf.action, callout: pf.callout } : { action: pf.action },
        pm: pm.callout !== undefined ? { action: pm.action, callout: pm.callout } : { action: pm.action },
        status: "ok",
      };
      current.rows.push(row);
    } else {
      const act = splitCallout(c3);
      const who = parseWho(c4);
      if (who === null) {
        unparse(i, `who must be PF, PM, BOTH or UNASSIGNED, found "${c4}"`);
        continue;
      }
      const row: Omit<Row, "id"> = { trigger, action: act.action, who, status: "ok" };
      if (act.callout !== undefined) row.callout = act.callout;
      current.rows.push(row);
    }
  }

  if (pendingTitle) {
    unparsed.push({
      line: pendingTitle.line,
      text: `## ${pendingTitle.title}`,
      reason: "heading has no table after it",
    });
  }

  return { gates, unparsed };
}

/** Attach stable ids to parsed gates. `makeId` must return unique ids. */
export function toGates(parsed: ParsedGate[], makeId: () => string): Gate[] {
  return parsed.map((g) => ({
    id: makeId(),
    title: g.title || "Untitled gate",
    layout: g.layout,
    rows: g.rows.map((r) => ({ id: makeId(), ...r })),
  }));
}
