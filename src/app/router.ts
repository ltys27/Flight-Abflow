import { useEffect, useState } from "react";

/** Hash routes (spec 6). Works on GitHub Pages without rewrites. */
export type Route =
  | { name: "library" }
  | { name: "read"; id: string }
  | { name: "edit"; id: string }
  | { name: "drill"; id: string }
  | { name: "review" }
  | { name: "open-items" }
  | { name: "annotations" }
  | { name: "sessions" }
  | { name: "session"; id: string }
  | { name: "settings" }
  | { name: "new" };

export function parseHash(hash: string): Route {
  const path = hash.replace(/^#/, "").replace(/^\/+/, "").split("?")[0] ?? "";
  const parts = path.split("/").filter(Boolean).map(decodeURIComponent);
  if (parts.length === 0) return { name: "library" };
  const [a, b, c] = parts;
  if (a === "p" && b) {
    if (c === "edit") return { name: "edit", id: b };
    if (c === "drill") return { name: "drill", id: b };
    return { name: "read", id: b };
  }
  if (a === "review") return { name: "review" };
  if (a === "open-items") return { name: "open-items" };
  if (a === "annotations") return { name: "annotations" };
  if (a === "sessions") return b ? { name: "session", id: b } : { name: "sessions" };
  if (a === "settings") return { name: "settings" };
  if (a === "new") return { name: "new" };
  return { name: "library" };
}

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parseHash(window.location.hash));
  useEffect(() => {
    const on = () => setRoute(parseHash(window.location.hash));
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return route;
}

export function navigate(to: string): void {
  window.location.hash = to.startsWith("#") ? to : `#${to}`;
}

export const href = {
  library: () => "#/",
  read: (id: string, rowId?: string) => `#/p/${encodeURIComponent(id)}${rowId ? `?row=${encodeURIComponent(rowId)}` : ""}`,
  edit: (id: string) => `#/p/${encodeURIComponent(id)}/edit`,
  drill: (id: string) => `#/p/${encodeURIComponent(id)}/drill`,
  review: () => "#/review",
  openItems: () => "#/open-items",
  annotations: () => "#/annotations",
  sessions: () => "#/sessions",
  session: (id: string) => `#/sessions/${encodeURIComponent(id)}`,
  settings: () => "#/settings",
  newProcedure: () => "#/new",
};

/** Query part of the hash, e.g. `#/p/x?row=abc`. */
export function hashQuery(): URLSearchParams {
  const q = window.location.hash.split("?")[1] ?? "";
  return new URLSearchParams(q);
}
