import { useLibrary } from "../state/LibraryProvider";
import { href } from "../app/router";
import { deriveNumbering } from "../content/numbering";
import { saveProcedure } from "../state/procedures";
import { useToast } from "../components/Toast";
import type { Procedure } from "../content/schema";

/** Every verify / to-fill row across the library (spec 6.5). */
export function OpenItemsScreen() {
  const lib = useLibrary();
  const toast = useToast();
  const groups = lib.entries
    .map((e) => {
      const numbering = deriveNumbering(e.procedure);
      const rows = e.procedure.gates.flatMap((g) => g.rows.filter((r) => r.status !== "ok").map((r) => ({ gate: g, row: r, number: numbering.rows.get(r.id) ?? "?" })));
      return { entry: e, rows };
    })
    .filter((g) => g.rows.length > 0);

  const markOk = async (p: Procedure, rowId: string, shipped: Procedure | undefined) => {
    const next: Procedure = {
      ...p,
      version: p.version + 1,
      gates: p.gates.map((g) => ({ ...g, rows: g.rows.map((r) => (r.id === rowId ? { ...r, status: "ok" as const, statusNote: undefined } : r)) })),
    };
    const prev = p;
    await saveProcedure(next, shipped);
    toast.show("Marked ok", { label: "Undo", run: () => void saveProcedure(prev, shipped) });
  };

  return (
    <>
      <h1>Open items</h1>
      {groups.length === 0 && <p className="muted">Nothing to verify or fill. {lib.loading && "Loading…"}</p>}
      {groups.map(({ entry, rows }) => (
        <section key={entry.id} className="card" aria-labelledby={`oi-${entry.id}`}>
          <h2 id={`oi-${entry.id}`} style={{ marginTop: 0 }}>
            <a href={href.read(entry.id)}>{entry.procedure.title}</a> <span className="small muted">({rows.length})</span>
          </h2>
          {rows.map(({ gate, row, number }) => (
            <div key={row.id} className="note-item">
              <div className="text">
                <span className={`status-badge ${row.status}`}>{row.status === "verify" ? "verify" : "to fill"}</span>{" "}
                <strong>{number}</strong> {row.trigger} <span className="small muted">· {gate.title}</span>
                {row.statusNote && <div className="small">{row.statusNote}</div>}
              </div>
              <a className="btn small" href={href.read(entry.id, row.id)}>Open</a>
              <button type="button" className="btn small" onClick={() => void markOk(entry.procedure, row.id, entry.shipped)}>Mark ok</button>
            </div>
          ))}
        </section>
      ))}
    </>
  );
}
