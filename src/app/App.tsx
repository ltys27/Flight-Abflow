import { useEffect, useState } from "react";
import { loadShippedLibrary, type LibraryLoadResult } from "../content/library";

/**
 * Milestone 1 shell: loads the shipped library and shows what validated and
 * what did not. The real screens (spec 6) arrive in milestone 2.
 */
export function App() {
  const [lib, setLib] = useState<LibraryLoadResult | null>(null);

  useEffect(() => {
    let alive = true;
    loadShippedLibrary().then((r) => {
      if (alive) setLib(r);
    });
    return () => {
      alive = false;
    };
  }, []);

  if (!lib) return <main><p className="muted">Loading library…</p></main>;

  return (
    <main>
      <h1>Flow Scripts</h1>
      {lib.issues.length > 0 && (
        <section className="card" aria-label="Validation problems">
          <strong>Files that did not load</strong>
          <ul>
            {lib.issues.map((i, k) => (
              <li key={k} className="issue">
                <code>{i.file}</code> at <code>{i.path}</code>: {i.message}
              </li>
            ))}
          </ul>
        </section>
      )}
      <ul aria-label="Procedures">
        {lib.index
          .filter((e) => lib.procedures.has(e.id))
          .map((e) => {
            const p = lib.procedures.get(e.id)!;
            const rows = p.gates.reduce((n, g) => n + g.rows.length, 0);
            return (
              <li key={e.id} className="card">
                <strong>{p.title}</strong>{" "}
                <span className="muted">
                  {p.category} · {p.fleets.join(", ")} · {p.gates.length} gates · {rows} rows · v{p.version}
                </span>
              </li>
            );
          })}
      </ul>
    </main>
  );
}
