import { useMemo, useState } from "react";
import { useLibrary } from "../state/LibraryProvider";
import { CATEGORIES, FLEETS, ProcedureSchema, type Category, type Fleet, type Procedure } from "../content/schema";
import { blankProcedure, duplicateProcedure, prepareForSave } from "../edit/model";
import { importJson, importMarkdown, slugify } from "../edit/import";
import { parseQuickRows } from "../edit/quickAdd";
import { createUserProcedure } from "../state/procedures";
import { href } from "../app/router";
import { newId } from "../util/id";
import { rowCount } from "../content/resolve";

type Mode = "blank" | "copy" | "import";

interface Preview {
  procedure: Procedure;
  kind: "JSON" | "Markdown tables" | "plain rows";
  problems: string[];
  clash: boolean;
}

export function NewProcedureScreen() {
  const lib = useLibrary();
  const existing = useMemo(() => new Set(lib.entries.map((e) => e.id)), [lib.entries]);
  const [mode, setMode] = useState<Mode>("blank");
  const [title, setTitle] = useState("");
  const [customId, setCustomId] = useState<string | null>(null);
  const [category, setCategory] = useState<Category>("MISC");
  const [fleets, setFleets] = useState<Fleet[]>([...FLEETS]);
  const [templateId, setTemplateId] = useState("");
  const [clear, setClear] = useState(true);
  const [text, setText] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState<string[]>([]);

  const unique = (base: string) => {
    const b = base || "procedure";
    if (!existing.has(b)) return b;
    let n = 2;
    while (existing.has(`${b}-${n}`)) n += 1;
    return `${b}-${n}`;
  };
  const id = customId ?? unique(slugify(title));
  const idClash = existing.has(id);
  const isJson = text.trim().startsWith("{");

  const finish = async (p: Procedure) => {
    const v = ProcedureSchema.safeParse(prepareForSave(p, p.title));
    if (!v.success) return setError(v.error.issues.map((i) => `${i.path.join(".") || "file"}: ${i.message}`));
    try {
      await createUserProcedure(v.data, lib.shippedIds);
      window.location.hash = href.edit(v.data.id);
    } catch (e) {
      setError([(e as Error).message]);
    }
  };

  const buildPreview = () => {
    setError([]);
    setPreview(null);
    if (isJson) {
      const r = importJson(text, existing);
      if (!r.ok) return setError(r.issues.map((i) => `${i.path}: ${i.message}`));
      const clash = r.summary.idClash;
      setPreview({ procedure: clash ? { ...r.procedure, id: unique(r.procedure.id) } : r.procedure, kind: "JSON", problems: clash ? [`A procedure with id “${r.procedure.id}” already exists, so this one will be added as a separate copy.`] : [], clash });
      return;
    }
    if (!title.trim()) return setError(["Give the procedure a name first."]);
    const md = importMarkdown(text, { id, title: title.trim(), category, fleets }, existing);
    if (md.procedure.gates.length > 0) {
      setPreview({ procedure: md.procedure, kind: "Markdown tables", problems: md.unparsed.map((u) => `Line ${u.line} skipped: ${u.reason}`), clash: false });
      return;
    }
    const q = parseQuickRows(text, "two-lane", newId);
    if (q.rows.length === 0) return setError(["Nothing recognisable. Use one row per line, like: Trigger | PF | PM"]);
    const p = blankProcedure(id, title.trim(), category, fleets);
    p.gates[0]!.rows = q.rows;
    setPreview({ procedure: p, kind: "plain rows", problems: q.skipped.map((s) => `Line ${s.line} skipped: ${s.reason}`), clash: false });
  };

  const nameAndType = (
    <>
      <label className="field"><span>Name</span>
        <input type="text" value={title} onChange={(e) => { setTitle(e.target.value); setPreview(null); }} placeholder="Name of the procedure" autoFocus enterKeyHint="done" />
      </label>
      <div className="field"><span className="small muted">Category</span>
        <div className="chips" role="group" aria-label="Category">
          {CATEGORIES.map((c) => <button key={c} type="button" className="chip" aria-pressed={category === c} onClick={() => setCategory(c)}>{c}</button>)}
        </div>
      </div>
      <div className="field"><span className="small muted">Fleets</span>
        <div className="chips" role="group" aria-label="Fleets">
          {FLEETS.map((f) => <button key={f} type="button" className="chip" aria-pressed={fleets.includes(f)} onClick={() => setFleets(fleets.includes(f) ? fleets.filter((x) => x !== f) : [...fleets, f])}>{f}</button>)}
        </div>
      </div>
      <details className="small">
        <summary className="muted">Advanced</summary>
        <label className="field"><span>Id (fixed once created; used in exports and sync)</span>
          <input type="text" value={id} autoCapitalize="none" onChange={(e) => setCustomId(slugify(e.target.value))} />
        </label>
        {idClash && <p style={{ color: "var(--danger)" }}>That id is already used.</p>}
      </details>
    </>
  );

  return (
    <>
      <h1>New procedure</h1>
      <div className="chips" role="tablist" aria-label="How to start">
        {([["blank", "Start blank"], ["copy", "Copy another"], ["import", "Paste or import"]] as Array<[Mode, string]>).map(([m, label]) => (
          <button key={m} type="button" role="tab" aria-selected={mode === m} className="chip" aria-pressed={mode === m} onClick={() => { setMode(m); setPreview(null); setError([]); }}>{label}</button>
        ))}
      </div>

      {mode === "blank" && (
        <form className="card" onSubmit={(e) => { e.preventDefault(); if (title.trim() && !idClash) void finish(blankProcedure(id, title.trim(), category, fleets)); }}>
          {nameAndType}
          <button type="submit" className="btn primary wide" disabled={!title.trim() || idClash}>Create and start writing</button>
          <p className="small muted">You'll land in the editor with the first gate and row ready to type into.</p>
        </form>
      )}

      {mode === "copy" && (
        <form className="card" onSubmit={(e) => { e.preventDefault(); const src = lib.get(templateId)?.procedure; if (src && title.trim() && !idClash) void finish(duplicateProcedure(src, id, title.trim(), clear)); }}>
          <label className="field"><span>Copy from</span>
            <select value={templateId} onChange={(e) => setTemplateId(e.target.value)} required><option value="">Choose…</option>{lib.entries.map((e) => <option key={e.id} value={e.id}>{e.procedure.title}</option>)}</select>
          </label>
          <div className="chips" role="group" aria-label="What to copy">
            <button type="button" className="chip" aria-pressed={clear} onClick={() => setClear(true)}>Layout only (empty rows)</button>
            <button type="button" className="chip" aria-pressed={!clear} onClick={() => setClear(false)}>Everything</button>
          </div>
          {nameAndType}
          <button type="submit" className="btn primary wide" disabled={!title.trim() || idClash || !templateId}>Create copy</button>
        </form>
      )}

      {mode === "import" && (
        <div className="card">
          <p className="small muted">Paste what you already have: plain rows (<code>Trigger | PF | PM</code>, spoken words in "quotes"), Markdown tables under <code>## Gate</code> headings, or an exported JSON file.</p>
          <label className="field"><span>Paste here</span>
            <textarea value={text} onChange={(e) => { setText(e.target.value); setPreview(null); }} style={{ minHeight: 160 }} />
          </label>
          <label className="btn">Choose a file…<input type="file" accept=".json,.md,.txt,application/json,text/markdown,text/plain" className="visually-hidden" onChange={async (e) => { const f = e.target.files?.[0]; if (f) { setText(await f.text()); setPreview(null); if (!title) setTitle(f.name.replace(/\.[^.]+$/, "")); } }} /></label>
          {!isJson && nameAndType}
          <div className="row-actions" style={{ marginTop: 8 }}>
            <button type="button" className="btn primary" onClick={buildPreview} disabled={!text.trim()}>Preview</button>
          </div>
          {preview && (
            <div className="banner" role="region" aria-label="Import preview">
              <strong>{preview.procedure.title}</strong>
              <div className="small muted">Read as {preview.kind} · {preview.procedure.gates.length} {preview.procedure.gates.length === 1 ? "gate" : "gates"} · {rowCount(preview.procedure)} rows</div>
              <ul className="small">{preview.procedure.gates.map((g) => <li key={g.id}>{g.title || "Untitled gate"}: {g.rows.length} rows</li>)}</ul>
              {preview.problems.length > 0 && <ul className="small" style={{ color: "var(--warn)" }}>{preview.problems.map((x, i) => <li key={i}>{x}</li>)}</ul>}
              {preview.clash && (
                <label className="field"><span>Import under a different id</span>
                  <input type="text" value={preview.procedure.id} autoCapitalize="none" onChange={(e) => setPreview({ ...preview, procedure: { ...preview.procedure, id: slugify(e.target.value) } })} />
                </label>
              )}
              <button type="button" className="btn primary wide" disabled={!preview.procedure.id || existing.has(preview.procedure.id)} onClick={() => void finish(preview.procedure)}>Create</button>
            </div>
          )}
        </div>
      )}

      {error.length > 0 && (
        <div className="banner danger" role="alert">
          <ul className="small" style={{ margin: 0 }}>{error.map((e, i) => <li key={i}>{e}</li>)}</ul>
        </div>
      )}
    </>
  );
}
