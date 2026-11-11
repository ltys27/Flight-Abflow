import { z } from "zod";

/**
 * Procedure content schema (spec section 3.2).
 *
 * TypeScript types are derived from these schemas; nothing here contains
 * procedure text. All display numbering is derived from position at render
 * time and is never stored.
 */

export const FLEETS = ["CEO", "NEO", "A321"] as const;
export const CATEGORIES = [
  "ENG",
  "HYD",
  "ELEC",
  "SMOKE",
  "PRESS",
  "FCTL",
  "FUEL",
  "NAV",
  "MISC",
] as const;
export const STATUSES = ["ok", "verify", "to-fill"] as const;
export const WHO = ["PF", "PM", "BOTH", "UNASSIGNED"] as const;
export const LAYOUTS = ["two-lane", "single-lane"] as const;

export const FleetSchema = z.enum(FLEETS);
export const CategorySchema = z.enum(CATEGORIES);
export const StatusSchema = z.enum(STATUSES);
export const WhoSchema = z.enum(WHO);
export const LayoutSchema = z.enum(LAYOUTS);

/** kebab-case: lowercase letters and digits separated by single hyphens. */
export const KEBAB_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const ProcedureIdSchema = z
  .string()
  .regex(KEBAB_ID, "must be kebab-case (lowercase letters, digits, hyphens)");

/** Stable element id (gates, rows). Any non-empty string without whitespace. */
export const ElementIdSchema = z
  .string()
  .min(1, "id must not be empty")
  .regex(/^\S+$/, "id must not contain whitespace");

/** ISO calendar date, YYYY-MM-DD. */
export const IsoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "must be an ISO date (YYYY-MM-DD)")
  .refine((s) => !Number.isNaN(Date.parse(s)), "must be a valid date");

export const LaneCellSchema = z
  .object({
    action: z.string(),
    callout: z.string().optional(),
    standing: z.boolean().optional(),
  })
  .strict();

export const RowOverrideSchema = z
  .object({
    trigger: z.string().optional(),
    pf: LaneCellSchema.optional(),
    pm: LaneCellSchema.optional(),
    action: z.string().optional(),
    who: WhoSchema.optional(),
    callout: z.string().optional(),
  })
  .strict();

export const RowSchema = z
  .object({
    id: ElementIdSchema,
    trigger: z.string(),
    pf: LaneCellSchema.optional(),
    pm: LaneCellSchema.optional(),
    action: z.string().optional(),
    who: WhoSchema.optional(),
    callout: z.string().optional(),
    status: StatusSchema,
    statusNote: z.string().optional(),
    why: z.string().optional(),
    sourceRef: z.string().optional(),
    variants: z.partialRecord(FleetSchema, RowOverrideSchema).optional(),
  })
  .strict();

export const BranchSchema = z
  .object({
    parentGateId: ElementIdSchema,
    condition: z.string().min(1, "branch condition must not be empty"),
  })
  .strict();

export const GateSchema = z
  .object({
    id: ElementIdSchema,
    title: z.string().min(1, "gate title must not be empty"),
    aim: z.string().optional(),
    layout: LayoutSchema,
    branch: BranchSchema.optional(),
    rows: z.array(RowSchema),
  })
  .strict();

export const ReferenceTableSchema = z
  .object({
    id: ElementIdSchema,
    title: z.string().min(1),
    note: z.string().optional(),
    columns: z.array(z.string()),
    rows: z.array(z.array(z.string())),
  })
  .strict()
  .superRefine((t, ctx) => {
    t.rows.forEach((r, i) => {
      if (r.length !== t.columns.length) {
        ctx.addIssue({
          code: "custom",
          path: ["rows", i],
          message: `row has ${r.length} cells but table has ${t.columns.length} columns`,
        });
      }
    });
  });

export const ProfilePointSchema = z
  .object({
    label: z.string().min(1),
    gateId: ElementIdSchema,
    altitudeFt: z.number().optional(),
  })
  .strict();

/**
 * Is a lane cell "completely empty" in the sense of spec 3.2?
 * A cell counts as having content when it has an action, a callout, or is a
 * standing task.
 */
function cellIsEmpty(cell: z.infer<typeof LaneCellSchema>): boolean {
  return cell.action.trim() === "" && (cell.callout ?? "").trim() === "" && !cell.standing;
}

export const ProcedureSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: ProcedureIdSchema,
    title: z.string().min(1, "title must not be empty"),
    category: CategorySchema,
    fleets: z.array(FleetSchema),
    tags: z.array(z.string()),
    version: z.number().int().nonnegative(),
    lastReviewed: IsoDateSchema.optional(),
    relatedProcedures: z.array(ProcedureIdSchema),
    gates: z.array(GateSchema),
    referenceTables: z.array(ReferenceTableSchema),
    profile: z.array(ProfilePointSchema).optional(),
  })
  .strict()
  .superRefine((p, ctx) => {
    // --- Structural rules that span more than one field ---------------------
    const gateIds = new Map<string, number>();
    const rowIds = new Map<string, [number, number]>();

    p.gates.forEach((gate, gi) => {
      if (gateIds.has(gate.id)) {
        ctx.addIssue({
          code: "custom",
          path: ["gates", gi, "id"],
          message: `duplicate gate id "${gate.id}" (also gates[${gateIds.get(gate.id)}])`,
        });
      } else {
        gateIds.set(gate.id, gi);
      }

      gate.rows.forEach((row, ri) => {
        const rowPath = ["gates", gi, "rows", ri] as const;

        if (rowIds.has(row.id)) {
          const [ogi, ori] = rowIds.get(row.id)!;
          ctx.addIssue({
            code: "custom",
            path: [...rowPath, "id"],
            message: `duplicate row id "${row.id}" (also gates[${ogi}].rows[${ori}])`,
          });
        } else {
          rowIds.set(row.id, [gi, ri]);
        }

        if (gate.layout === "two-lane") {
          if (!row.pf) {
            ctx.addIssue({
              code: "custom",
              path: [...rowPath, "pf"],
              message: "two-lane row must have a pf cell",
            });
          }
          if (!row.pm) {
            ctx.addIssue({
              code: "custom",
              path: [...rowPath, "pm"],
              message: "two-lane row must have a pm cell",
            });
          }
          if (row.status !== "to-fill") {
            if (row.pf && cellIsEmpty(row.pf)) {
              ctx.addIssue({
                code: "custom",
                path: [...rowPath, "pf"],
                message:
                  'pf cell is empty: give it an action or callout, set standing: true, or set the row status to "to-fill"',
              });
            }
            if (row.pm && cellIsEmpty(row.pm)) {
              ctx.addIssue({
                code: "custom",
                path: [...rowPath, "pm"],
                message:
                  'pm cell is empty: give it an action or callout, set standing: true, or set the row status to "to-fill"',
              });
            }
          }
          if (row.action !== undefined || row.who !== undefined || row.callout !== undefined) {
            ctx.addIssue({
              code: "custom",
              path: [...rowPath],
              message: "two-lane row must not use action/who/callout (single-lane fields)",
            });
          }
        } else {
          if (row.pf !== undefined || row.pm !== undefined) {
            ctx.addIssue({
              code: "custom",
              path: [...rowPath],
              message: "single-lane row must not use pf/pm (two-lane fields)",
            });
          }
          if (row.action === undefined) {
            ctx.addIssue({
              code: "custom",
              path: [...rowPath, "action"],
              message: "single-lane row must have an action",
            });
          }
          if (row.who === undefined) {
            ctx.addIssue({
              code: "custom",
              path: [...rowPath, "who"],
              message: "single-lane row must have who",
            });
          }
        }
      });
    });

    // Branch gates must point at an existing, different gate.
    p.gates.forEach((gate, gi) => {
      if (!gate.branch) return;
      if (!gateIds.has(gate.branch.parentGateId)) {
        ctx.addIssue({
          code: "custom",
          path: ["gates", gi, "branch", "parentGateId"],
          message: `unknown parent gate id "${gate.branch.parentGateId}"`,
        });
      } else if (gate.branch.parentGateId === gate.id) {
        ctx.addIssue({
          code: "custom",
          path: ["gates", gi, "branch", "parentGateId"],
          message: "a gate cannot be its own branch parent",
        });
      }
    });

    // Profile points must reference existing gates.
    p.profile?.forEach((pt, i) => {
      if (!gateIds.has(pt.gateId)) {
        ctx.addIssue({
          code: "custom",
          path: ["profile", i, "gateId"],
          message: `unknown gate id "${pt.gateId}"`,
        });
      }
    });

    // Reference table ids must be unique.
    const tableIds = new Set<string>();
    p.referenceTables.forEach((t, i) => {
      if (tableIds.has(t.id)) {
        ctx.addIssue({
          code: "custom",
          path: ["referenceTables", i, "id"],
          message: `duplicate reference table id "${t.id}"`,
        });
      }
      tableIds.add(t.id);
    });

    // A procedure must not list itself as related.
    p.relatedProcedures.forEach((rid, i) => {
      if (rid === p.id) {
        ctx.addIssue({
          code: "custom",
          path: ["relatedProcedures", i],
          message: "a procedure cannot be related to itself",
        });
      }
    });
  });

export const IndexEntrySchema = z
  .object({
    id: ProcedureIdSchema,
    file: z.string().min(1),
    title: z.string().min(1),
    category: CategorySchema,
    fleets: z.array(FleetSchema),
    version: z.number().int().nonnegative(),
  })
  .strict();

export const IndexSchema = z.array(IndexEntrySchema).superRefine((entries, ctx) => {
  const seen = new Map<string, number>();
  entries.forEach((e, i) => {
    if (seen.has(e.id)) {
      ctx.addIssue({
        code: "custom",
        path: [i, "id"],
        message: `duplicate procedure id "${e.id}" (also [${seen.get(e.id)}])`,
      });
    }
    seen.set(e.id, i);
  });
});

export type Fleet = z.infer<typeof FleetSchema>;
export type Category = z.infer<typeof CategorySchema>;
export type Status = z.infer<typeof StatusSchema>;
export type Who = z.infer<typeof WhoSchema>;
export type Layout = z.infer<typeof LayoutSchema>;
export type LaneCell = z.infer<typeof LaneCellSchema>;
export type RowOverride = z.infer<typeof RowOverrideSchema>;
export type Row = z.infer<typeof RowSchema>;
export type Branch = z.infer<typeof BranchSchema>;
export type Gate = z.infer<typeof GateSchema>;
export type ReferenceTable = z.infer<typeof ReferenceTableSchema>;
export type ProfilePoint = z.infer<typeof ProfilePointSchema>;
export type Procedure = z.infer<typeof ProcedureSchema>;
export type IndexEntry = z.infer<typeof IndexEntrySchema>;
export type ProcedureIndex = z.infer<typeof IndexSchema>;
