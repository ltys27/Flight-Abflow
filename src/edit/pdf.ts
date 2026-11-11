import type { Procedure, Row, LaneCell, Gate } from "../content/schema";
import type { Annotation } from "../annotations/types";
import { deriveNumbering } from "../content/numbering";

/**
 * Structured PDF export (jsPDF + jspdf-autotable, loaded on demand).
 * One table per gate, callouts in bold, standing cells muted, status flags,
 * optional rationale/source and user notes, reference tables at the end.
 */
export interface PdfOptions {
  includeWhy: boolean;
  includeNotes: boolean;
  includeReferenceTables: boolean;
  fleetLabel?: string | null;
  notes?: Annotation[];
}

/** Marker in front of callout lines so the cell renderer can bold them. */
const CALLOUT = "\u0001";
/** Marker in front of muted (standing / meta) lines. */
const MUTED = "\u0002";

function laneText(cell: LaneCell | undefined): string {
  if (!cell) return "—";
  const lines: string[] = [];
  if (cell.standing) lines.push(`${MUTED}${cell.action || "(continues)"}`);
  else if (cell.action.trim()) lines.push(cell.action);
  if (cell.callout) lines.push(`${CALLOUT}“${cell.callout}”`);
  if (lines.length === 0) lines.push(`${MUTED}—`);
  return lines.join("\n");
}

function triggerText(row: Row, opts: PdfOptions, notes: Annotation[]): string {
  const lines = [row.trigger || "—"];
  if (row.status === "verify") lines.push(`${MUTED}VERIFY${row.statusNote ? `: ${row.statusNote}` : ""}`);
  if (row.status === "to-fill") lines.push(`${MUTED}TO FILL${row.statusNote ? `: ${row.statusNote}` : ""}`);
  if (opts.includeWhy) {
    if (row.why) lines.push(`${MUTED}Why: ${row.why}`);
    if (row.sourceRef) lines.push(`${MUTED}Source: ${row.sourceRef}`);
  }
  if (opts.includeNotes) for (const n of notes) if (n.kind === "note" && n.text) lines.push(`${MUTED}Note: ${n.text}`);
  return lines.join("\n");
}

const RGB = {
  text: [24, 26, 33] as [number, number, number],
  muted: [110, 116, 130] as [number, number, number],
  pf: [37, 99, 235] as [number, number, number],
  pm: [21, 128, 61] as [number, number, number],
  pfBg: [235, 241, 255] as [number, number, number],
  pmBg: [233, 247, 238] as [number, number, number],
  head: [240, 242, 246] as [number, number, number],
  line: [205, 209, 218] as [number, number, number],
  warn: [180, 83, 9] as [number, number, number],
  danger: [185, 28, 28] as [number, number, number],
};

export async function buildProcedurePdf(p: Procedure, opts: PdfOptions): Promise<Blob> {
  const [{ jsPDF }, { autoTable }] = await Promise.all([import("jspdf"), import("jspdf-autotable")]);
  const doc = new jsPDF({ unit: "pt", format: "a4", orientation: "portrait" });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 40;
  const numbering = deriveNumbering(p);
  const notesByRow = new Map<string, Annotation[]>();
  for (const n of opts.notes ?? []) if (n.target.rowId) notesByRow.set(n.target.rowId, [...(notesByRow.get(n.target.rowId) ?? []), n]);

  // ---- Title block -------------------------------------------------------
  let y = margin;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(20);
  doc.setTextColor(...RGB.text);
  const titleLines = doc.splitTextToSize(p.title, pageW - margin * 2) as string[];
  doc.text(titleLines, margin, y + 16);
  y += 16 + titleLines.length * 24;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(...RGB.muted);
  const meta = [
    `Category ${p.category}`,
    `Fleets ${p.fleets.join(", ") || "—"}${opts.fleetLabel ? ` (shown: ${opts.fleetLabel})` : ""}`,
    `Version ${p.version}`,
    p.lastReviewed ? `Last reviewed ${p.lastReviewed}` : "Not yet reviewed",
    p.tags.length ? `Tags ${p.tags.join(", ")}` : "",
  ].filter(Boolean).join("   ·   ");
  const metaLines = doc.splitTextToSize(meta, pageW - margin * 2) as string[];
  doc.text(metaLines, margin, y);
  y += metaLines.length * 13 + 6;
  doc.setDrawColor(...RGB.line);
  doc.line(margin, y, pageW - margin, y);
  y += 14;

  // ---- Gates --------------------------------------------------------------
  const headerFor = (g: Gate) => (g.layout === "two-lane" ? ["#", "Trigger", "PF", "PM"] : ["#", "Trigger", "Action", "Who"]);
  for (const g of p.gates) {
    const label = numbering.gates.get(g.id) ?? "";
    const heading = `${label}  ${g.title}${g.branch ? `   — branch: ${g.branch.condition}` : ""}`;
    // Keep heading with its table: start a new page if too close to the bottom.
    if (y > pageH - margin - 90) {
      doc.addPage();
      y = margin;
    }
    doc.setFont("helvetica", "bold");
    doc.setFontSize(13);
    doc.setTextColor(...RGB.text);
    doc.text(doc.splitTextToSize(heading, pageW - margin * 2) as string[], margin, y + 10);
    y += 18;
    if (g.aim) {
      doc.setFont("helvetica", "italic");
      doc.setFontSize(9.5);
      doc.setTextColor(...RGB.muted);
      const aim = doc.splitTextToSize(g.aim, pageW - margin * 2) as string[];
      doc.text(aim, margin, y + 6);
      y += aim.length * 12 + 2;
    }
    const body = g.rows.map((r) => {
      const num = numbering.rows.get(r.id) ?? "";
      const trig = triggerText(r, opts, notesByRow.get(r.id) ?? []);
      if (g.layout === "two-lane") return [num, trig, laneText(r.pf), laneText(r.pm)];
      const act = [r.action || `${MUTED}—`, r.callout ? `${CALLOUT}“${r.callout}”` : ""].filter(Boolean).join("\n");
      return [num, trig, act, r.who ?? "UNASSIGNED"];
    });
    const twoLane = g.layout === "two-lane";
    autoTable(doc, {
      startY: y + 4,
      margin: { left: margin, right: margin, top: margin, bottom: margin },
      head: [headerFor(g)],
      body: body.length ? body : [["", `${MUTED}No rows`, "", ""]],
      theme: "grid",
      styles: { font: "helvetica", fontSize: 9.5, cellPadding: 5, lineColor: RGB.line, lineWidth: 0.5, textColor: RGB.text, valign: "top", overflow: "linebreak" },
      headStyles: { fillColor: RGB.head, textColor: RGB.muted, fontStyle: "bold", fontSize: 8.5 },
      columnStyles: twoLane
        ? { 0: { cellWidth: 34, textColor: RGB.muted }, 1: { cellWidth: 150, fontStyle: "bold" }, 2: { fillColor: RGB.pfBg }, 3: { fillColor: RGB.pmBg } }
        : { 0: { cellWidth: 34, textColor: RGB.muted }, 1: { cellWidth: 150, fontStyle: "bold" }, 3: { cellWidth: 70 } },
      didParseCell: (data) => {
        if (data.section === "head" && twoLane) {
          if (data.column.index === 2) data.cell.styles.textColor = RGB.pf;
          if (data.column.index === 3) data.cell.styles.textColor = RGB.pm;
        }
      },
      willDrawCell: (data) => {
        if (data.section !== "body") return undefined;
        const lines = data.cell.text;
        if (!lines.some((l) => l.startsWith(CALLOUT) || l.startsWith(MUTED))) return undefined;
        // Draw the cell ourselves: background + border first, then mixed-style lines.
        const d = data.doc as InstanceType<typeof jsPDF>;
        const c = data.cell;
        const fill = c.styles.fillColor;
        if (Array.isArray(fill)) {
          d.setFillColor(fill[0]!, fill[1]!, fill[2]!);
          d.rect(c.x, c.y, c.width, c.height, "F");
        }
        d.setDrawColor(...RGB.line);
        d.setLineWidth(0.5);
        d.rect(c.x, c.y, c.width, c.height, "S");
        const k = d.internal.scaleFactor;
        const fontSize = c.styles.fontSize;
        const lineHeight = (fontSize / k) * d.getLineHeightFactor();
        let ty = c.y + c.padding("top") + (fontSize / k) * (2 - 1.15);
        const tx = c.x + c.padding("left");
        const baseStyle = c.styles.fontStyle === "bold" ? "bold" : "normal";
        let mode: "normal" | "callout" | "muted" = "normal";
        for (const raw of lines) {
          let line = raw;
          if (line.startsWith(CALLOUT)) {
            mode = "callout";
            line = line.slice(1);
          } else if (line.startsWith(MUTED)) {
            mode = "muted";
            line = line.slice(1);
          }
          d.setFontSize(fontSize);
          if (mode === "callout") {
            d.setFont("helvetica", "bold");
            d.setTextColor(...RGB.text);
          } else if (mode === "muted") {
            const flag = line.startsWith("VERIFY") ? "verify" : line.startsWith("TO FILL") ? "to-fill" : null;
            d.setFont("helvetica", flag ? "bold" : "italic");
            d.setTextColor(...(flag === "verify" ? RGB.warn : flag === "to-fill" ? RGB.danger : RGB.muted));
          } else {
            d.setFont("helvetica", baseStyle);
            d.setTextColor(...RGB.text);
          }
          d.text(line, tx, ty);
          ty += lineHeight;
        }
        return false;
      },
    });
    y = ((doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable?.finalY ?? y) + 18;
  }

  // ---- Reference tables ---------------------------------------------------
  if (opts.includeReferenceTables && p.referenceTables.length) {
    if (y > pageH - margin - 90) {
      doc.addPage();
      y = margin;
    }
    doc.setFont("helvetica", "bold");
    doc.setFontSize(13);
    doc.setTextColor(...RGB.text);
    doc.text("Reference tables", margin, y + 10);
    y += 22;
    for (const t of p.referenceTables) {
      doc.setFont("helvetica", "bold");
      doc.setFontSize(11);
      doc.text(t.title, margin, y + 8);
      y += 14;
      if (t.note) {
        doc.setFont("helvetica", "italic");
        doc.setFontSize(9.5);
        doc.setTextColor(...RGB.muted);
        const note = doc.splitTextToSize(t.note, pageW - margin * 2) as string[];
        doc.text(note, margin, y + 6);
        y += note.length * 12;
        doc.setTextColor(...RGB.text);
      }
      autoTable(doc, {
        startY: y + 4,
        margin: { left: margin, right: margin, top: margin, bottom: margin },
        head: [t.columns],
        body: t.rows,
        theme: "grid",
        styles: { font: "helvetica", fontSize: 9, cellPadding: 4, lineColor: RGB.line, lineWidth: 0.5, textColor: RGB.text },
        headStyles: { fillColor: RGB.head, textColor: RGB.muted, fontStyle: "bold", fontSize: 8.5 },
      });
      y = ((doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable?.finalY ?? y) + 16;
    }
  }

  // ---- Footer on every page ----------------------------------------------
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(...RGB.muted);
    doc.text(`${p.title} · v${p.version}`, margin, pageH - 20);
    doc.text(`${i} / ${pages}`, pageW - margin, pageH - 20, { align: "right" });
  }
  return doc.output("blob");
}

export function downloadBlob(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
