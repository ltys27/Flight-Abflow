import type { z } from "zod";
import {
  IndexSchema,
  ProcedureSchema,
  type Procedure,
  type ProcedureIndex,
} from "./schema";

/** One validation problem, ready for display (spec 3.2: file, path, message). */
export interface ValidationIssue {
  file: string;
  /** JSON path such as `gates[0].rows[2].pf` ("$" for the root). */
  path: string;
  message: string;
}

export type ValidationResult<T> =
  | { ok: true; value: T; file: string }
  | { ok: false; issues: ValidationIssue[]; file: string };

/** Format a zod issue path as a JSON path string. */
export function formatPath(path: readonly PropertyKey[]): string {
  if (path.length === 0) return "$";
  let out = "";
  for (const seg of path) {
    if (typeof seg === "number") {
      out += `[${seg}]`;
    } else {
      const s = String(seg);
      out += /^[A-Za-z_$][\w$]*$/.test(s) ? (out ? `.${s}` : s) : `[${JSON.stringify(s)}]`;
    }
  }
  return out;
}

function toIssues(file: string, error: z.ZodError): ValidationIssue[] {
  return error.issues.map((i) => ({
    file,
    path: formatPath(i.path),
    message: i.message,
  }));
}

/** Parse raw JSON text, then validate. JSON syntax errors become a root issue. */
function parseJsonText(file: string, text: string): { ok: true; data: unknown } | { ok: false; issue: ValidationIssue } {
  try {
    return { ok: true, data: JSON.parse(text) };
  } catch (e) {
    return {
      ok: false,
      issue: { file, path: "$", message: `invalid JSON: ${(e as Error).message}` },
    };
  }
}

export function validateProcedure(file: string, data: unknown): ValidationResult<Procedure> {
  const r = ProcedureSchema.safeParse(data);
  return r.success ? { ok: true, value: r.data, file } : { ok: false, issues: toIssues(file, r.error), file };
}

export function validateProcedureText(file: string, text: string): ValidationResult<Procedure> {
  const p = parseJsonText(file, text);
  if (!p.ok) return { ok: false, issues: [p.issue], file };
  return validateProcedure(file, p.data);
}

export function validateIndex(file: string, data: unknown): ValidationResult<ProcedureIndex> {
  const r = IndexSchema.safeParse(data);
  return r.success ? { ok: true, value: r.data, file } : { ok: false, issues: toIssues(file, r.error), file };
}

export function validateIndexText(file: string, text: string): ValidationResult<ProcedureIndex> {
  const p = parseJsonText(file, text);
  if (!p.ok) return { ok: false, issues: [p.issue], file };
  return validateIndex(file, p.data);
}
