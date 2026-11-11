import { db, ensurePersisted, type OverlayRecord } from "../db/db";
import type { Procedure } from "../content/schema";
import { nowIso } from "../util/id";
import { touchDataChanged } from "./settings";

export type ProcedureSource = "overlay" | "user" | "shipped";

export interface ResolvedProcedure {
  procedure: Procedure;
  source: ProcedureSource;
  /** Shipped procedure, when one exists with this id. */
  shipped?: Procedure;
  /** True when the shipped version is newer than the overlay's base (spec 4). */
  upstreamChanged: boolean;
  baseVersion?: number;
  updatedAt?: string;
}

export function resolve(
  id: string,
  shipped: Procedure | undefined,
  overlay: OverlayRecord | undefined,
  user: { procedure: Procedure; updatedAt: string } | undefined,
): ResolvedProcedure | null {
  if (overlay) {
    return {
      procedure: overlay.procedure,
      source: "overlay",
      shipped,
      upstreamChanged: !!shipped && shipped.version > overlay.baseVersion,
      baseVersion: overlay.baseVersion,
      updatedAt: overlay.updatedAt,
    };
  }
  if (user) return { procedure: user.procedure, source: "user", upstreamChanged: false, updatedAt: user.updatedAt };
  if (shipped) return { procedure: shipped, source: "shipped", shipped, upstreamChanged: false };
  void id;
  return null;
}

/** Save an edited procedure: shipped ids go to overlays, others to userProcedures. */
export async function saveProcedure(p: Procedure, shipped: Procedure | undefined): Promise<void> {
  await ensurePersisted();
  const updatedAt = nowIso();
  if (shipped) {
    const existing = await db.overlays.get(p.id);
    await db.overlays.put({
      procedureId: p.id,
      procedure: p,
      baseVersion: existing?.baseVersion ?? shipped.version,
      updatedAt,
    });
  } else {
    await db.userProcedures.put({ procedureId: p.id, procedure: p, updatedAt });
  }
  await touchDataChanged();
}

/** Create a user procedure (new or imported). Fails if the id exists anywhere. */
export async function createUserProcedure(p: Procedure, shippedIds: Set<string>): Promise<void> {
  await ensurePersisted();
  if (shippedIds.has(p.id) || (await db.userProcedures.get(p.id))) {
    throw new Error(`A procedure with id "${p.id}" already exists`);
  }
  await db.userProcedures.put({ procedureId: p.id, procedure: p, updatedAt: nowIso() });
  await touchDataChanged();
}

export async function deleteUserProcedure(id: string): Promise<void> {
  await db.userProcedures.delete(id);
  await touchDataChanged();
}

/** "Take shipped": drop the overlay so the shipped file shows again. */
export async function discardOverlay(id: string): Promise<void> {
  await db.overlays.delete(id);
  await touchDataChanged();
}

/** "Keep mine": re-base the overlay on the current shipped version without changing content. */
export async function rebaseOverlay(id: string, shippedVersion: number): Promise<void> {
  const o = await db.overlays.get(id);
  if (!o) return;
  await db.overlays.put({ ...o, baseVersion: shippedVersion, updatedAt: nowIso() });
}
