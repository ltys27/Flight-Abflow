import { validateProcedureText, type ValidationIssue } from "../content/validate";
import type { Procedure } from "../content/schema";
import { parseMarkdown, toGates, type UnparsedLine } from "../import/markdown";
import { newId } from "../util/id";
import { rowCount } from "../content/resolve";

export interface ImportSummary {
  gates: number;
  rows: number;
  idClash: boolean;
  id: string;
  title: string;
}

export function importJson(text: string, existingIds: Set<string>): { ok: true; procedure: Procedure; summary: ImportSummary } | { ok: false; issues: ValidationIssue[] } {
  const r = validateProcedureText("import.json", text);
  if (!r.ok) return r;
  const p = r.value;
  return { ok: true, procedure: p, summary: { gates: p.gates.length, rows: rowCount(p), idClash: existingIds.has(p.id), id: p.id, title: p.title } };
}

export function importMarkdown(text: string, meta: { id: string; title: string; category: Procedure["category"]; fleets: Procedure["fleets"] }, existingIds: Set<string>): { procedure: Procedure; unparsed: UnparsedLine[]; summary: ImportSummary } {
  const parsed = parseMarkdown(text);
  const gates = toGates(parsed.gates, newId);
  const procedure: Procedure = { schemaVersion: 1, id: meta.id, title: meta.title, category: meta.category, fleets: meta.fleets, tags: [], version: 1, relatedProcedures: [], gates, referenceTables: [] };
  // Rows with empty lanes are marked to-fill so the file validates (nothing is invented).
  for (const g of procedure.gates) {
    for (const r of g.rows) {
      const pfEmpty = r.pf && !r.pf.action && !r.pf.callout;
      const pmEmpty = r.pm && !r.pm.action && !r.pm.callout;
      if ((g.layout === "two-lane" && (pfEmpty || pmEmpty)) || (g.layout === "single-lane" && !r.action && !r.callout)) {
        r.status = "to-fill";
        r.statusNote = "Imported with an empty cell";
      }
    }
  }
  return { procedure, unparsed: parsed.unparsed, summary: { gates: gates.length, rows: rowCount(procedure), idClash: existingIds.has(meta.id), id: meta.id, title: meta.title } };
}

export const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").replace(/-{2,}/g, "-");
