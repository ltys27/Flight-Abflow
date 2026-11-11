import { customAlphabet } from "nanoid";
/** Stable ids for gates, rows, annotations. URL-safe, lowercase. */
export const newId = customAlphabet("0123456789abcdefghijklmnopqrstuvwxyz", 12);
export const nowIso = () => new Date().toISOString();
export const todayIso = () => new Date().toISOString().slice(0, 10);
