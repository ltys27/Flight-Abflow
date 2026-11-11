import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "../db/db";
import { createSession, deleteSession, setActiveSession } from "../state/sessions";
import { useSetting } from "../state/settings";
import { href } from "../app/router";
import { useLibrary } from "../state/LibraryProvider";
import { todayIso } from "../util/id";
import { downloadText, safeFilename } from "../edit/export";
import { Confirm } from "../components/Confirm";
import { AnnotationItem } from "../annotations/RowAnnotations";
import { deleteAnnotation, restoreAnnotation } from "../annotations/store";
import { useToast } from "../components/Toast";
import { findRow } from "../content/resolve";

export function SessionsScreen() {
  const sessions = useLiveQuery(() => db.sessions.orderBy("createdAt").reverse().toArray(), [], []);
  const active = useSetting("activeSessionId");
  const [name, setName] = useState("");
  const [date, setDate] = useState(todayIso());
  return (
    <>
      <h1>Debrief sessions</h1>
      <form className="card" onSubmit={async (e) => { e.preventDefault(); if (!name.trim()) return; await createSession(name.trim(), date); setName(""); }}>
        <label className="field"><span>Session name</span><input type="text" value={name} onChange={(e) => setName(e.target.value)} required /></label>
        <label className="field"><span>Date</span><input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
        <button type="submit" className="btn primary">Create and activate</button>
      </form>
      {active && <p className="banner">A session is active: new notes are stamped with it. <button type="button" className="btn small" onClick={() => void setActiveSession(null)}>Stop</button></p>}
      {sessions.map((s) => (
        <div key={s.id} className="card">
          <a href={href.session(s.id)}><strong>{s.name}</strong></a> <span className="small muted">{s.date}</span>{" "}
          {active === s.id ? <span className="chip tiny">active</span> : <button type="button" className="btn small" onClick={() => void setActiveSession(s.id)}>Activate</button>}
        </div>
      ))}
    </>
  );
}

export function SessionScreen({ id }: { id: string }) {
  const lib = useLibrary();
  const toast = useToast();
  const session = useLiveQuery(() => db.sessions.get(id), [id]);
  const notes = useLiveQuery(() => db.annotations.where("sessionId").equals(id).toArray(), [id], []);
  const [confirm, setConfirm] = useState(false);
  if (!session) return <p>Session not found. <a href={href.sessions()}>Back</a></p>;
  const groups = new Map<string, typeof notes>();
  for (const n of notes) groups.set(n.target.procedureId, [...(groups.get(n.target.procedureId) ?? []), n]);

  const exportMd = () => {
    const lines = [`# ${session.name}`, "", `Date: ${session.date}`, ""];
    for (const [pid, ns] of groups) {
      const entry = lib.get(pid);
      lines.push(`## ${entry?.procedure.title ?? pid}`, "");
      for (const n of ns) {
        const hit = entry && n.target.rowId ? findRow(entry.procedure, n.target.rowId) : null;
        lines.push(`- ${hit ? `**${hit.row.trigger}** — ` : ""}${(n.text ?? "").replace(/\n/g, " ")}`);
      }
      lines.push("");
    }
    downloadText(`${safeFilename(session.name)}.md`, lines.join("\n"), "text/markdown");
  };

  return (
    <>
      <div className="proc-header">
        <h1>{session.name}</h1>
        <span className="small muted">{session.date} · {notes.length} notes</span>
        <div className="row-actions" style={{ flex: "1 1 100%" }}>
          <button type="button" className="btn" onClick={exportMd}>Export Markdown</button>
          <button type="button" className="btn danger" onClick={() => setConfirm(true)}>Delete session</button>
          <a className="btn" href={href.sessions()}>All sessions</a>
        </div>
      </div>
      {[...groups].map(([pid, ns]) => (
        <section key={pid} className="card">
          <h2 style={{ marginTop: 0 }}><a href={href.read(pid)}>{lib.get(pid)?.procedure.title ?? pid}</a></h2>
          {ns.map((n) => {
            const entry = lib.get(pid);
            const hit = entry && n.target.rowId ? findRow(entry.procedure, n.target.rowId) : null;
            return (
              <div key={n.id}>
                {hit && <div className="small muted"><a href={href.read(pid, n.target.rowId)}>{hit.row.trigger}</a></div>}
                <AnnotationItem a={n} onDelete={async () => { const r = await deleteAnnotation(n.id); if (r) toast.show("Deleted", { label: "Undo", run: () => void restoreAnnotation(r) }); }} />
              </div>
            );
          })}
        </section>
      ))}
      {confirm && <Confirm title="Delete session?" message="Notes are kept; they only lose the session stamp." danger confirmLabel="Delete" onCancel={() => setConfirm(false)} onConfirm={async () => { await deleteSession(id); window.location.hash = href.sessions(); }} />}
    </>
  );
}
