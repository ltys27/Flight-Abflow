/** Minimal GitHub Contents API client (fetch, CORS-friendly). */
export class SyncConflictError extends Error {
  constructor() {
    super("The file changed on GitHub while syncing");
    this.name = "SyncConflictError";
  }
}
export class SyncHttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = "SyncHttpError";
  }
}

export interface RemoteFile {
  sha: string;
  /** Decoded bytes. */
  bytes: Uint8Array;
}

export interface RepoClient {
  getFile(path: string): Promise<RemoteFile | null>;
  putFile(path: string, bytes: Uint8Array, message: string, sha?: string): Promise<string>;
  test(): Promise<{ ok: boolean; message: string }>;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64.replace(/\s/g, ""));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function githubClient(cfg: { repo: string; branch: string; token: string }, fetchFn: typeof fetch = fetch): RepoClient {
  const base = `https://api.github.com/repos/${cfg.repo}/contents/`;
  const headers = (accept = "application/vnd.github+json") => ({
    Accept: accept,
    Authorization: `Bearer ${cfg.token}`,
    "X-GitHub-Api-Version": "2022-11-28",
  });
  const enc = (p: string) => p.split("/").map(encodeURIComponent).join("/");
  const fail = async (res: Response) => {
    let msg = `${res.status} ${res.statusText}`;
    try {
      const j = (await res.json()) as { message?: string };
      if (j.message) msg = `${res.status}: ${j.message}`;
    } catch {
      /* no body */
    }
    throw new SyncHttpError(res.status, msg);
  };
  return {
    async getFile(path) {
      const url = `${base}${enc(path)}?ref=${encodeURIComponent(cfg.branch)}`;
      const res = await fetchFn(url, { headers: headers() });
      if (res.status === 404) return null;
      if (!res.ok) return fail(res);
      const j = (await res.json()) as { sha: string; content?: string; encoding?: string; size?: number };
      if (j.content && j.encoding === "base64") return { sha: j.sha, bytes: base64ToBytes(j.content) };
      // Files over 1 MB come back without content: fetch raw bytes.
      const raw = await fetchFn(url, { headers: headers("application/vnd.github.raw+json") });
      if (!raw.ok) return fail(raw);
      return { sha: j.sha, bytes: new Uint8Array(await raw.arrayBuffer()) };
    },
    async putFile(path, bytes, message, sha) {
      const res = await fetchFn(`${base}${enc(path)}`, {
        method: "PUT",
        headers: { ...headers(), "Content-Type": "application/json" },
        body: JSON.stringify({ message, content: bytesToBase64(bytes), branch: cfg.branch, ...(sha ? { sha } : {}) }),
      });
      if (res.status === 409 || res.status === 422) throw new SyncConflictError();
      if (!res.ok) return fail(res);
      const j = (await res.json()) as { content: { sha: string } };
      return j.content.sha;
    },
    async test() {
      const res = await fetchFn(`https://api.github.com/repos/${cfg.repo}`, { headers: headers() });
      if (res.status === 404) return { ok: false, message: "Repository not found, or the token cannot see it." };
      if (res.status === 401) return { ok: false, message: "Token rejected (401)." };
      if (!res.ok) return { ok: false, message: `${res.status} ${res.statusText}` };
      const j = (await res.json()) as { private?: boolean; permissions?: { push?: boolean } };
      if (j.permissions && !j.permissions.push) return { ok: false, message: "Token can read the repository but not write to it. Grant Contents: read and write." };
      return { ok: true, message: `Connected${j.private ? " (private repository)" : " — note: this repository is PUBLIC"}.` };
    },
  };
}
