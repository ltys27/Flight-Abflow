import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { loadShippedLibrary, type LibraryLoadResult } from "../content/library";
import type { Procedure } from "../content/schema";
import type { ValidationIssue } from "../content/validate";
import { db } from "../db/db";
import { resolve, type ResolvedProcedure } from "./procedures";

export interface LibraryEntry extends ResolvedProcedure {
  id: string;
}

interface LibraryContextValue {
  loading: boolean;
  issues: ValidationIssue[];
  shipped: Map<string, Procedure>;
  shippedIds: Set<string>;
  /** Every procedure visible in the library, resolved. */
  entries: LibraryEntry[];
  get: (id: string) => LibraryEntry | undefined;
}

const Ctx = createContext<LibraryContextValue | null>(null);

export function LibraryProvider({ children, preload }: { children: ReactNode; preload?: LibraryLoadResult }) {
  const [shippedResult, setShippedResult] = useState<LibraryLoadResult | null>(preload ?? null);

  useEffect(() => {
    if (preload) return;
    let alive = true;
    loadShippedLibrary().then((r) => alive && setShippedResult(r));
    return () => {
      alive = false;
    };
  }, [preload]);

  const overlays = useLiveQuery(() => db.overlays.toArray(), [], undefined);
  const users = useLiveQuery(() => db.userProcedures.toArray(), [], undefined);

  const value = useMemo<LibraryContextValue>(() => {
    const shipped = shippedResult?.procedures ?? new Map<string, Procedure>();
    const overlayMap = new Map((overlays ?? []).map((o) => [o.procedureId, o]));
    const userMap = new Map((users ?? []).map((u) => [u.procedureId, u]));
    const ids = new Set<string>([...shipped.keys(), ...overlayMap.keys(), ...userMap.keys()]);
    const entries: LibraryEntry[] = [];
    for (const id of ids) {
      const r = resolve(id, shipped.get(id), overlayMap.get(id), userMap.get(id));
      if (r) entries.push({ id, ...r });
    }
    const byId = new Map(entries.map((e) => [e.id, e]));
    return {
      loading: shippedResult === null || overlays === undefined || users === undefined,
      issues: shippedResult?.issues ?? [],
      shipped,
      shippedIds: new Set(shipped.keys()),
      entries,
      get: (id) => byId.get(id),
    };
  }, [shippedResult, overlays, users]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useLibrary(): LibraryContextValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("useLibrary outside LibraryProvider");
  return v;
}

export function useProcedure(id: string): LibraryEntry | undefined {
  return useLibrary().get(id);
}
