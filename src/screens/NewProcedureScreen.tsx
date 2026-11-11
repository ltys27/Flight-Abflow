import { useState } from "react";
import { useLibrary } from "../state/LibraryProvider";
import { CATEGORIES, FLEETS, ProcedureSchema, type Category, type Fleet, type Procedure } from "../content/schema";
import { blankProcedure, duplicateProcedure } from "../edit/model";
import { importJson, importMarkdown, slugify, type ImportSummary } from "../edit/import";
import { createUserProcedure } from "../state/procedures";
import { href } from "../app/router";
import { useToast } from "../components/Toast";
import type { UnparsedLine } from "../import/markdown";
import type { ValidationIssue } from "../content/validate";

type Mode = "blank" | "template" | "json" | "markdown";

export function NewProcedureScreen() {
  const lib = useLibrary();
  const toast = useToast();
  const existing = new Set(lib.entries.map((e) => e.id));
  const [mode, setMode] = useState<Mode>("blank");
  const [title, setTitle] = useState("");
  const [id, setId] = useState("");
  const [idTouched, setIdTouched] = useState(false);
  const [category, setCategory] = useState<Category>("MISC");
  const [fleets, setFleets] = useState<Fleet[]>([...FLEETS]);
  const [templateId, setTemplateId] = useState("");
  const [clear, setClear] = useState(true);
  const [text, setText] = useState("");
  const [preview, setPreview] = useState<{ procedure: Procedure; summary: ImportSummary; unparsed: UnparsedLine[] } | null>(null);
  const [issues, setIssues] = useState<ValidationIssue[]>([]);
  const effectiveId = idTouched ? id : slugify(title);
  const clash = existing.has(effectiveId);

  const finish = async (p: Procedure) => {
    const v = ProcedureSchema.safeParse(p);
    if (!v.success) {
      setIssues(v.error.issues.map((i) => ({ file: "new", path: i.path.join("."), message: i.message })));
      return;
    }
    try {
      await createUserProcedure(v.data, lib.shippedIds);
      toast.show("Procedure created");
      window.location.hash = href.edit(v.data.id);
    } catch (e) {
      setIssues([{ file: "new", path: "id", message: (e as Error).message }]);
    }
  };

  const buildPreview = () => {
    setIssues([]);
    if (mode === "json") {
      const r = importJson(text, existing);
      if (!r.ok) return setIssues(r.issues);
      setPreview({ procedure: r.procedure, summary: r.summary, unparsed: [] });
    } else {
      if (!effectiveId || !title) return setIssues([{ file: "new", path: "title", message: "Give the procedure a title first" }]);
      const r = importMarkdown(text, { id: effectiveId, title, category, fleets }, existing);
      setPreview(r);
    }
  };

  const metaFields = (
    <>
      <label className="field"><span>Title</span><input type="text" value={title} onChange={(e) => setTitle(e.target.value)} required /></label>
      <label className="field"><span>Id (kebab-case, never changes)</span><input type="text" value={effectiveId} onChange={(e) => { setIdTouched(true); setId(slugify(e.target.value)); }} /></label>
      {clash && <p className="banner danger">A procedure with this id already exists.</p>}
      <label className="field"><span>Category</span>
        <select value={category} onChange={(e) => setCategory(e.target.value as Category)}>{CATEGORIES.map((c) => <option key={c}>{c}</option>)}</select>
      </label>
      <div className="chips" role="group" aria-label="Fleets">
        {FLEETS.map((f) => (
          <button key={f} type="button" className="chip" aria-pressed={fleets.includes(f)} onClick={() => setFleets(fleets.includes(f) ? fleets.filter((x) => x !== f) : [...fleets, f])}>{f}</button>
        ))}
      </div>
    </>
  );

  return (
    <>
      <h1>New procedure</h1>
      <div className="chips" role="tablist" aria-label="Source">
        {(["blank", "template", "json", "markdown"] as Mode[]).map((m) => (
          <button key={m} type="button" role="tab" aria-selected={mode === m} className="chip" aria-pressed={mode === m} onClick={() => { setMode(m); setPreview(null); setIssues([]); }}>
            {m === "blank" ? "Blank" : m === "template" ? "From existing" : m === "json" ? "Import JSON" : "Import Markdown"}
          </button>
        ))}
      </div>
      <div className="card">
        {mode === "blank" && (
          <form onSubmit={(e) => { e.preventDefault(); void finish(blankProcedure(effectiveId, title, category, fleets)); }}>
            {metaFields}
            <button type="submit" className="btn primary" disabled={!title || !effectiveId || clash}>Create</button>
          </form>
        )}
        {mode === "template" && (
          <form onSubmit={(e) => { e.preventDefault(); const src = lib.get(templateId)?.procedure; if (src) void finish(duplicateProcedure(src, effectiveId, title, clear)); }}>
            <label className="field"><span>Copy structure from</span>
              <select value={templateId} onChange={(e) => setTemplateId(e.target.value)} required><option value="">Choose…</option>{lib.entries.map((e) => <option key={e.id} value={e.id}>{e.procedure.title}</option>)}</select>
            </label>
            <label className="field"><span>Content</span>
              <select value={clear ? "clear" : "keep"} onChange={(e) => setClear(e.target.value === "clear")}><option value="clear">Clear row text, keep gates and row count</option><option value="keep">Keep everything (full copy)</option></select>
            </label>
            {metaFields}
            <button type="submit" className="btn primary" disabled={!title || !effectiveId || clash || !templateId}>Create</button>
          </form>
        )}
        {(mode === "json" || mode === "markdown") && (
          <div>
            {mode === "markdown" && metaFields}
            <label className="field"><span>{mode === "json" ? "Procedure JSON" : "Markdown (## headings and | # | Trigger | PF | PM | tables)"}</span>
              <textarea value={text} onChange={(e) => { setText(e.target.value); setPreview(null); }} style={{ minHeight: 160, fontFamily: "ui-monospace, monospace" }} />
            </label>
            <div className="row-actions">
              <label className="btn">Choose file…<input type="file" accept=".json,.md,.txt,application/json,text/markdown" className="visually-hidden" onChange={async (e) => { const f = e.target.files?.[0]; if (f) { setText(await f.text()); setPreview(null); if (mode === "markdown" && !title) setTitle(f.name.replace(/\.[^.]+$/, "")); } }} /></label>
              <button type="button" className="btn primary" onClick={buildPreview} disabled={!text.trim()}>Validate and preview</button>
            </div>
          </div>
        )}
        {issues.length > 0 && (
          <div className="banner danger" role="alert">
            <strong>Could not import</strong>
            <ul className="small">{issues.map((i, k) => <li key={k}><code>{i.path || "$"}</code>: {i.message}</li>)}</ul>
          </div>
        )}
        {preview && (
          <div className="banner" role="region" aria-label="Import preview">
            <div className="kv small">
              <span>Title</span><span>{preview.summary.title}</span>
              <span>Id</span><span>{preview.summary.id}{preview.summary.idClash && <strong style={{ color: "var(--danger)" }}> — already exists</strong>}</span>
              <span>Gates</span><span>{preview.summary.gates}</span>
              <span>Rows</span><span>{preview.summary.rows}</span>
            </div>
            {preview.summary.idClash && mode === "json" && (
              <label className="field"><span>Import under a different id</span>
                <input type="text" placeholder="new-id" onChange={(e) => setPreview({ ...preview, procedure: { ...preview.procedure, id: slugify(e.target.value) }, summary: { ...preview.summary, id: slugify(e.target.value), idClash: existing.has(slugify(e.target.value)) } })} />
              </label>
            )}
            {preview.unparsed.length > 0 && (
              <div>
                <strong>Lines that could not be parsed ({preview.unparsed.length})</strong>
                <ul className="small">{preview.unparsed.map((u) => <li key={u.line}>line {u.line}: {u.reason} — <code>{u.text.slice(0, 80)}</code></li>)}</ul>
              </div>
            )}
            <ul className="small">
              {preview.procedure.gates.map((g) => <li key={g.id}>{g.title || "(untitled)"} — {g.layout}, {g.rows.length} rows</li>)}
            </ul>
            <button type="button" className="btn primary" disabled={preview.summary.idClash || !preview.summary.id} onClick={() => void finish(preview.procedure)}>Apply import</button>
          </div>
        )}
      </div>
    </>
  );
}
