import { useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { useLibrary } from "../state/LibraryProvider";
import { CATEGORIES, FLEETS, STATUSES, type Category, type Fleet, type Status } from "../content/schema";
import { openItemCount, rowCount, searchableText } from "../content/resolve";
import { href } from "../app/router";
import { db } from "../db/db";
import { useProcedureStats } from "../schedule/useStats";
import { useSettings } from "../state/settings";

type Sort = "recent" | "alpha" | "due" | "weak";

export function LibraryScreen() {
  const lib = useLibrary();
  const settings = useSettings();
  const [q, setQ] = useState("");
  const [cat, setCat] = useState<Category | null>(null);
  const [fleet, setFleet] = useState<Fleet | null>(null);
  const [status, setStatus] = useState<Status | null>(null);
  const [tag, setTag] = useState<string | null>(null);
  const [sort, setSort] = useState<Sort>("recent");

  const notes = useLiveQuery(() => db.annotations.where("kind").equals("note").toArray(), [], []);
  const procedures = useMemo(() => lib.entries.map((e) => e.procedure), [lib.entries]);
  const stats = useProcedureStats(procedures);

  const allTags = useMemo(() => {
    const s = new Set<string>();
    for (const p of procedures) p.tags.forEach((t) => s.add(t));
    return [...s].sort();
  }, [procedures]);

  const noteText = useMemo(() => {
    const m = new Map<string, string>();
    for (const n of notes) {
      m.set(n.target.procedureId, `${m.get(n.target.procedureId) ?? ""}\n${(n.text ?? "").toLowerCase()}`);
    }
    return m;
  }, [notes]);

  const list = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return lib.entries
      .filter((e) => {
        const p = e.procedure;
        if (cat && p.category !== cat) return false;
        if (fleet && !p.fleets.includes(fleet)) return false;
        if (tag && !p.tags.includes(tag)) return false;
        if (status && !p.gates.some((g) => g.rows.some((r) => r.status === status))) return false;
        if (needle && !searchableText(p).includes(needle) && !(noteText.get(p.id) ?? "").includes(needle)) return false;
        return true;
      })
      .sort((a, b) => {
        const sa = stats.get(a.id);
        const sb = stats.get(b.id);
        switch (sort) {
          case "alpha":
            return a.procedure.title.localeCompare(b.procedure.title);
          case "due":
            return (sb?.due ?? 0) - (sa?.due ?? 0) || a.procedure.title.localeCompare(b.procedure.title);
          case "weak":
            return (sb?.weakness ?? 0) - (sa?.weakness ?? 0) || a.procedure.title.localeCompare(b.procedure.title);
          default: {
            const la = settings.lastOpened[a.id] ?? "";
            const lb = settings.lastOpened[b.id] ?? "";
            return lb.localeCompare(la) || a.procedure.title.localeCompare(b.procedure.title);
          }
        }
      });
  }, [lib.entries, q, cat, fleet, tag, status, sort, stats, noteText, settings.lastOpened]);

  return (
    <>
      <div className="proc-header">
        <h1>Library</h1>
        <a className="btn" href={href.newProcedure()}>
          + New
        </a>
      </div>
      {lib.issues.length > 0 && (
        <section className="banner danger" aria-label="Files that did not load">
          <strong>Some shipped files did not load</strong>
          <ul className="small">
            {lib.issues.map((i, k) => (
              <li key={k}>
                <code>{i.file}</code> at <code>{i.path}</code>: {i.message}
              </li>
            ))}
          </ul>
        </section>
      )}
      <label className="field">
        <span className="visually-hidden">Search title, tags, row text and notes</span>
        <input type="search" placeholder="Search title, tags, rows, notes" value={q} onChange={(e) => setQ(e.target.value)} />
      </label>
      <div className="chips" role="group" aria-label="Category filter">
        {CATEGORIES.map((c) => (
          <button key={c} type="button" className="chip" aria-pressed={cat === c} onClick={() => setCat(cat === c ? null : c)}>
            {c}
          </button>
        ))}
      </div>
      <div className="chips" role="group" aria-label="Fleet and status filter" style={{ marginTop: 6 }}>
        {FLEETS.map((f) => (
          <button key={f} type="button" className="chip" aria-pressed={fleet === f} onClick={() => setFleet(fleet === f ? null : f)}>
            {f}
          </button>
        ))}
        {STATUSES.filter((s) => s !== "ok").map((s) => (
          <button key={s} type="button" className="chip" aria-pressed={status === s} onClick={() => setStatus(status === s ? null : s)}>
            has {s}
          </button>
        ))}
        {allTags.map((t) => (
          <button key={t} type="button" className="chip" aria-pressed={tag === t} onClick={() => setTag(tag === t ? null : t)}>
            #{t}
          </button>
        ))}
      </div>
      <label className="field" style={{ maxWidth: 260 }}>
        <span>Sort</span>
        <select value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
          <option value="recent">Recently opened</option>
          <option value="alpha">Alphabetical</option>
          <option value="due">Most due</option>
          <option value="weak">Weakest</option>
        </select>
      </label>
      {lib.loading && <p className="muted">Loading…</p>}
      {!lib.loading && list.length === 0 && <p className="muted">No procedures match.</p>}
      <ul style={{ listStyle: "none", padding: 0, margin: 0 }} aria-label="Procedures">
        {list.map((e) => {
          const p = e.procedure;
          const s = stats.get(e.id);
          const open = openItemCount(p);
          const last = settings.lastOpened[e.id];
          return (
            <li key={e.id}>
              <a className="card link" href={href.read(e.id)}>
                <strong>{p.title}</strong>{" "}
                {e.source !== "shipped" && <span className="chip tiny">{e.source === "overlay" ? "edited" : "mine"}</span>}
                {e.upstreamChanged && <span className="chip tiny">update available</span>}
                <div className="small muted">
                  {p.category} · {p.fleets.join(", ") || "no fleet"} · {rowCount(p)} rows
                  {open > 0 && <> · <span style={{ color: "var(--warn)" }}>{open} open</span></>}
                  {s && s.due > 0 && <> · <span style={{ color: "var(--accent)" }}>{s.due} due</span></>}
                  {s && s.readiness !== null && <> · ready {Math.round(s.readiness * 100)}%</>}
                  {last && <> · opened {new Date(last).toLocaleDateString()}</>}
                </div>
                {p.tags.length > 0 && (
                  <div className="chips" style={{ marginTop: 4 }}>
                    {p.tags.map((t) => (
                      <span key={t} className="chip tiny">#{t}</span>
                    ))}
                  </div>
                )}
              </a>
            </li>
          );
        })}
      </ul>
    </>
  );
}
