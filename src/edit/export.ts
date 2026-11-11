import type { Procedure, Row } from "../content/schema";

export function downloadText(filename: string, text: string, mime = "application/json"): void {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const procedureToJson = (p: Procedure) => JSON.stringify(p, null, 2) + "\n";

const esc = (s: string) => s.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
const cell = (action: string, callout?: string) => [esc(action), callout ? `**${esc(callout)}**` : ""].filter(Boolean).join(" ");

/** Markdown tables in the same shape the importer reads (spec 6.3 / 6.4). */
export function procedureToMarkdown(p: Procedure): string {
  const lines: string[] = [`# ${p.title}`, ""];
  lines.push(`Category: ${p.category} · Fleets: ${p.fleets.join(", ") || "—"} · Version: ${p.version}`, "");
  let n = 0;
  for (const g of p.gates) {
    n += 1;
    lines.push(`## ${g.title}${g.branch ? ` (branch: ${g.branch.condition})` : ""}`, "");
    if (g.aim) lines.push(`_${g.aim}_`, "");
    if (g.layout === "two-lane") {
      lines.push("| # | Trigger | PF | PM |", "|---|---|---|---|");
      g.rows.forEach((r: Row, i: number) => {
        lines.push(`| ${n}.${i + 1} | ${esc(r.trigger)}${statusMark(r)} | ${cell(r.pf?.action ?? "", r.pf?.callout)} | ${cell(r.pm?.action ?? "", r.pm?.callout)} |`);
      });
    } else {
      lines.push("| # | Trigger | Action | Who |", "|---|---|---|---|");
      g.rows.forEach((r: Row, i: number) => {
        lines.push(`| ${n}.${i + 1} | ${esc(r.trigger)}${statusMark(r)} | ${cell(r.action ?? "", r.callout)} | ${r.who ?? ""} |`);
      });
    }
    lines.push("");
  }
  for (const t of p.referenceTables) {
    lines.push(`### ${t.title}`, "");
    if (t.note) lines.push(t.note, "");
    lines.push(`| ${t.columns.map(esc).join(" | ")} |`, `|${t.columns.map(() => "---").join("|")}|`);
    for (const r of t.rows) lines.push(`| ${r.map(esc).join(" | ")} |`);
    lines.push("");
  }
  return lines.join("\n");
}

function statusMark(r: Row): string {
  if (r.status === "ok") return "";
  return ` (${r.status === "verify" ? "verify" : "to fill"}${r.statusNote ? `: ${esc(r.statusNote)}` : ""})`;
}

export const safeFilename = (s: string) => s.replace(/[^a-z0-9-_]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase() || "procedure";
