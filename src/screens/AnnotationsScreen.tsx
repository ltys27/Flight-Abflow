import { useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "../db/db";
import { useLibrary } from "../state/LibraryProvider";
import { href } from "../app/router";
import { AnnotationItem } from "../annotations/RowAnnotations";
import { deleteAnnotation, restoreAnnotation } from "../annotations/store";
import { useToast } from "../components/Toast";
import type { AnnotationKind, Confidence } from "../annotations/types";
import { findRow } from "../content/resolve";

const KINDS: AnnotationKind[] = ["note", "highlight", "tag", "confidence", "ink", "voice"];

/** All annotations with filters (spec 5). */
export function AnnotationsScreen() {
  const lib = useLibrary();
  const toast = useToast();
  const all = useLiveQuery(() => db.annotations.orderBy("updatedAt").reverse().toArray(), [], []);
  const sessions = useLiveQuery(() => db.sessions.toArray(), [], []);
  const [kind, setKind] = useState<AnnotationKind | "">("");
  const [tag, setTag] = useState("");
  const [conf, setConf] = useState<Confidence | "">("");
  const [proc, setProc] = useState("");
  const [session, setSession] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const tags = useMemo(() => [...new Set(all.filter((a) => a.kind === "tag").map((a) => a.tag!))].sort(), [all]);
  const list = all.filter((a) => {
    if (kind && a.kind !== kind) return false;
    if (tag && !(a.kind === "tag" && a.tag === tag)) return false;
    if (conf && !(a.kind === "confidence" && a.confidence === conf)) return false;
    if (proc && a.target.procedureId !== proc) return false;
    if (session && a.sessionId !== session) return false;
    if (from && a.updatedAt < from) return false;
    if (to && a.updatedAt.slice(0, 10) > to) return false;
    return true;
  });

  return (
    <>
      <div className="proc-header">
        <h1>Annotations</h1>
        <a className="btn" href={href.sessions()}>Debrief sessions</a>
      </div>
      <div className="edit-grid two">
        <label className="field"><span>Kind</span>
          <select value={kind} onChange={(e) => setKind(e.target.value as AnnotationKind | "")}><option value="">All</option>{KINDS.map((k) => <option key={k} value={k}>{k}</option>)}</select>
        </label>
        <label className="field"><span>Tag</span>
          <select value={tag} onChange={(e) => setTag(e.target.value)}><option value="">All</option>{tags.map((t) => <option key={t} value={t}>#{t}</option>)}</select>
        </label>
        <label className="field"><span>Confidence</span>
          <select value={conf} onChange={(e) => setConf(e.target.value as Confidence | "")}><option value="">All</option><option value="weak">weak</option><option value="ok">ok</option><option value="solid">solid</option></select>
        </label>
        <label className="field"><span>Procedure</span>
          <select value={proc} onChange={(e) => setProc(e.target.value)}><option value="">All</option>{lib.entries.map((e) => <option key={e.id} value={e.id}>{e.procedure.title}</option>)}</select>
        </label>
        <label className="field"><span>Session</span>
          <select value={session} onChange={(e) => setSession(e.target.value)}><option value="">All</option>{sessions.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.date})</option>)}</select>
        </label>
        <label className="field"><span>From</span><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
        <label className="field"><span>To</span><input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
      </div>
      <p className="small muted">{list.length} of {all.length}</p>
      {list.map((a) => {
        const entry = lib.get(a.target.procedureId);
        const hit = entry && a.target.rowId ? findRow(entry.procedure, a.target.rowId) : null;
        return (
          <div key={a.id} className="card">
            <div className="small muted">
              <a href={href.read(a.target.procedureId, a.target.rowId)}>{entry?.procedure.title ?? a.target.procedureId}</a>
              {hit ? ` · ${hit.row.trigger}` : a.target.rowId ? " · (row no longer exists)" : ""}
            </div>
            <AnnotationItem a={a} onDelete={async () => { const r = await deleteAnnotation(a.id); if (r) toast.show("Deleted", { label: "Undo", run: () => void restoreAnnotation(r) }); }} />
          </div>
        );
      })}
    </>
  );
}
