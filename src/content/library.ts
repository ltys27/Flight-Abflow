import type { Procedure, ProcedureIndex } from "./schema";
import {
  validateIndexText,
  validateProcedureText,
  type ValidationIssue,
} from "./validate";

/**
 * Loads the shipped procedure library from /procedures (spec 3.1).
 * A file that fails validation is reported with file, path and message, and
 * the rest of the library still loads (spec 3.2).
 */
export interface LibraryLoadResult {
  index: ProcedureIndex;
  procedures: Map<string, Procedure>;
  issues: ValidationIssue[];
}

export const PROCEDURES_BASE = "procedures/";

async function fetchText(path: string): Promise<string> {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

export async function loadShippedLibrary(
  base: string = PROCEDURES_BASE,
  fetchFn: (path: string) => Promise<string> = fetchText,
): Promise<LibraryLoadResult> {
  const issues: ValidationIssue[] = [];
  const procedures = new Map<string, Procedure>();
  const indexFile = "index.json";

  let indexText: string;
  try {
    indexText = await fetchFn(base + indexFile);
  } catch (e) {
    issues.push({ file: indexFile, path: "$", message: `could not load: ${(e as Error).message}` });
    return { index: [], procedures, issues };
  }

  const indexResult = validateIndexText(indexFile, indexText);
  if (!indexResult.ok) {
    issues.push(...indexResult.issues);
    return { index: [], procedures, issues };
  }

  await Promise.all(
    indexResult.value.map(async (entry) => {
      let text: string;
      try {
        text = await fetchFn(base + entry.file);
      } catch (e) {
        issues.push({ file: entry.file, path: "$", message: `could not load: ${(e as Error).message}` });
        return;
      }
      const r = validateProcedureText(entry.file, text);
      if (!r.ok) {
        issues.push(...r.issues);
        return;
      }
      if (r.value.id !== entry.id) {
        issues.push({
          file: entry.file,
          path: "id",
          message: `procedure id "${r.value.id}" does not match index entry "${entry.id}"`,
        });
        return;
      }
      procedures.set(r.value.id, r.value);
    }),
  );

  return { index: indexResult.value, procedures, issues };
}
