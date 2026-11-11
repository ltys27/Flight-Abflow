import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Procedure } from "../src/content/schema";

export function readJson(rel: string): unknown {
  return JSON.parse(readFileSync(resolve(process.cwd(), rel), "utf8"));
}

/** Deep-cloned demo procedure for mutation in tests. */
export function demo(): Procedure {
  return structuredClone(readJson("public/procedures/demo-procedure.json")) as Procedure;
}
