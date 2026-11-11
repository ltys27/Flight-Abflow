/**
 * Seed conversion (spec 3.3): converts a Markdown flow script into a
 * procedure JSON file using the Markdown import rules of spec 6.4, then
 * applies the seed status rules:
 *
 *   - a cell containing "verify" becomes status "verify"; the remark next to
 *     the word (e.g. "(verify: source unclear)") is moved to statusNote and
 *     removed from the cell;
 *   - a cell containing "to fill" becomes status "to-fill";
 *   - a two-lane row whose PF and PM cells are both empty becomes "to-fill"
 *     with its trigger kept as the prompt text.
 *
 * No wording is changed; only the markers above are moved into status fields.
 * Every status decision is printed so it can be checked against the source.
 *
 * Usage: npm run convert-seed -- seed/all-engines-fail.md <id> "<title>" <CATEGORY> [fleets=CEO,NEO,A321] [out.json]
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { customAlphabet } from "nanoid";
import { parseMarkdown, toGates } from "../src/import/markdown";
import { ProcedureSchema, type Procedure, type Row } from "../src/content/schema";
import { formatPath } from "../src/content/validate";

const nanoid = customAlphabet("0123456789abcdefghijklmnopqrstuvwxyz", 10);

const [, , input, id, title, category, fleetsArg, outArg] = process.argv;
if (!input || !id || !title || !category) {
  console.error('usage: convert-seed <file.md> <id> "<title>" <CATEGORY> [fleets=CEO,NEO,A321] [out.json]');
  process.exit(2);
}
if (!existsSync(input)) {
  console.error(`seed file not found: ${input}`);
  process.exit(2);
}

const fleets = (fleetsArg?.replace(/^fleets=/, "") ?? "CEO,NEO,A321").split(",") as Procedure["fleets"];
const md = readFileSync(input, "utf8");
const parsed = parseMarkdown(md);

const VERIFY = /\(?\s*\bverify\b\s*[:\-–]?\s*([^)]*)\)?/i;
const TO_FILL = /\(?\s*\bto\s*fill\b\s*[:\-–]?\s*([^)]*)\)?/i;

function extract(text: string, re: RegExp): { text: string; note: string } | null {
  const m = re.exec(text);
  if (!m) return null;
  const note = (m[1] ?? "").trim();
  const stripped = (text.slice(0, m.index) + text.slice(m.index + m[0].length)).replace(/\s+/g, " ").trim();
  return { text: stripped, note };
}

const decisions: string[] = [];

function applyStatus(row: Row, label: string): void {
  const cells: Array<[string, { get(): string; set(v: string): void }]> = [];
  cells.push(["trigger", { get: () => row.trigger, set: (v) => (row.trigger = v) }]);
  if (row.pf) cells.push(["pf", { get: () => row.pf!.action, set: (v) => (row.pf!.action = v) }]);
  if (row.pm) cells.push(["pm", { get: () => row.pm!.action, set: (v) => (row.pm!.action = v) }]);
  if (row.action !== undefined) cells.push(["action", { get: () => row.action!, set: (v) => (row.action = v) }]);

  for (const [name, c] of cells) {
    const tf = extract(c.get(), TO_FILL);
    if (tf) {
      c.set(tf.text);
      row.status = "to-fill";
      if (tf.note) row.statusNote = tf.note;
      decisions.push(`${label}: ${name} marked to-fill${tf.note ? ` (note: "${tf.note}")` : ""}`);
      return;
    }
  }
  for (const [name, c] of cells) {
    const v = extract(c.get(), VERIFY);
    if (v) {
      c.set(v.text);
      row.status = "verify";
      if (v.note) row.statusNote = v.note;
      decisions.push(`${label}: ${name} marked verify${v.note ? ` (note: "${v.note}")` : ""}`);
      return;
    }
  }
  if (row.pf && row.pm && row.pf.action === "" && row.pm.action === "") {
    row.status = "to-fill";
    decisions.push(`${label}: both lanes empty, marked to-fill (trigger kept as prompt)`);
  }
}

const gates = toGates(parsed.gates, nanoid);
gates.forEach((g, gi) => g.rows.forEach((r, ri) => applyStatus(r, `gate ${gi + 1} "${g.title}" row ${ri + 1}`)));

const procedure: Procedure = {
  schemaVersion: 1,
  id: id!,
  title: title!,
  category: category as Procedure["category"],
  fleets,
  tags: [],
  version: 1,
  relatedProcedures: [],
  gates,
  referenceTables: [],
};

const result = ProcedureSchema.safeParse(procedure);
console.log(`Parsed ${gates.length} gate(s), ${gates.reduce((n, g) => n + g.rows.length, 0)} row(s).`);
if (parsed.unparsed.length) {
  console.log("\nLines that could not be parsed:");
  for (const u of parsed.unparsed) console.log(`  line ${u.line}: ${u.reason}\n    ${u.text}`);
}
if (decisions.length) {
  console.log("\nStatus decisions (check against the source):");
  for (const d of decisions) console.log(`  ${d}`);
}
if (!result.success) {
  console.error("\nResult does not validate:");
  for (const i of result.error.issues) console.error(`  ${formatPath(i.path)}: ${i.message}`);
  process.exit(1);
}
const out = outArg ? resolve(outArg) : resolve("public/procedures", `${id}.json`);
writeFileSync(out, JSON.stringify(result.data, null, 2) + "\n");
console.log(`\nWrote ${out}. Remember to add it to public/procedures/index.json.`);
