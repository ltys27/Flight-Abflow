import { useEffect, useRef, useState } from "react";
import { db, ensurePersisted } from "../db/db";
import { newId, nowIso } from "../util/id";

export const VOICE_MAX_MS = 3 * 60 * 1000;

/** MediaRecorder voice memo with level meter, timer and 3-minute cap (spec 5). */
export function VoiceRecorder({ onSaved, onCancel }: { onSaved: (blobId: string, durationMs: number) => void; onCancel: () => void }) {
  const [state, setState] = useState<"idle" | "recording" | "denied" | "unsupported" | "saving">("idle");
  const [error, setError] = useState<string | null>(null);
  const [level, setLevel] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const rec = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const startedAt = useRef(0);
  const raf = useRef(0);
  const stream = useRef<MediaStream | null>(null);
  const ctx = useRef<AudioContext | null>(null);

  const cleanup = () => {
    cancelAnimationFrame(raf.current);
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
    void ctx.current?.close();
    ctx.current = null;
  };
  useEffect(() => cleanup, []);

  const start = async () => {
    if (typeof MediaRecorder === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setState("unsupported");
      return;
    }
    try {
      stream.current = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (e) {
      setState("denied");
      setError((e as Error).name === "NotAllowedError" ? "Microphone permission was denied. Allow the microphone for this site in your browser settings and try again." : `Could not start the microphone: ${(e as Error).message}`);
      return;
    }
    const r = new MediaRecorder(stream.current);
    rec.current = r;
    chunks.current = [];
    r.ondataavailable = (e) => e.data.size && chunks.current.push(e.data);
    r.onstop = async () => {
      setState("saving");
      const durationMs = Math.min(Date.now() - startedAt.current, VOICE_MAX_MS);
      const blob = new Blob(chunks.current, { type: r.mimeType || "audio/webm" });
      const id = newId();
      await ensurePersisted();
      await db.blobs.put({ id, mime: blob.type, data: blob, updatedAt: nowIso() });
      cleanup();
      onSaved(id, durationMs);
    };
    try {
      ctx.current = new AudioContext();
      const src = ctx.current.createMediaStreamSource(stream.current);
      const analyser = ctx.current.createAnalyser();
      analyser.fftSize = 256;
      src.connect(analyser);
      const buf = new Uint8Array(analyser.frequencyBinCount);
      const tick = () => {
        analyser.getByteTimeDomainData(buf);
        let sum = 0;
        for (const v of buf) sum += (v - 128) ** 2;
        setLevel(Math.min(1, Math.sqrt(sum / buf.length) / 40));
        setElapsed(Date.now() - startedAt.current);
        if (Date.now() - startedAt.current >= VOICE_MAX_MS) stop();
        else raf.current = requestAnimationFrame(tick);
      };
      raf.current = requestAnimationFrame(tick);
    } catch {
      /* meter is optional */
    }
    startedAt.current = Date.now();
    r.start();
    setState("recording");
  };
  const stop = () => {
    if (rec.current?.state === "recording") rec.current.stop();
  };
  const fmt = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, "0")}`;

  return (
    <div>
      {state === "idle" && (
        <div className="row-actions">
          <button type="button" className="btn primary" onClick={() => void start()}>Start recording</button>
          <button type="button" className="btn" onClick={onCancel}>Cancel</button>
        </div>
      )}
      {state === "recording" && (
        <div>
          <div className="meter" aria-hidden="true"><div style={{ width: `${level * 100}%` }} /></div>
          <p aria-live="polite">Recording {fmt(elapsed)} / {fmt(VOICE_MAX_MS)}</p>
          <div className="row-actions">
            <button type="button" className="btn primary" onClick={stop}>Stop and save</button>
            <button type="button" className="btn" onClick={() => { rec.current && (rec.current.onstop = null); stop(); cleanup(); onCancel(); }}>Discard</button>
          </div>
        </div>
      )}
      {state === "saving" && <p>Saving…</p>}
      {(state === "denied" || state === "unsupported") && (
        <div>
          <p className="banner danger">{state === "unsupported" ? "Voice memos are not supported in this browser." : error}</p>
          <button type="button" className="btn" onClick={onCancel}>Close</button>
        </div>
      )}
    </div>
  );
}

/** Plays a stored voice memo. */
export function VoicePlayer({ blobId, durationMs }: { blobId: string; durationMs?: number }) {
  const [url, setUrl] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);
  useEffect(() => {
    let u: string | null = null;
    db.blobs.get(blobId).then((b) => {
      if (!b) return setMissing(true);
      u = URL.createObjectURL(b.data);
      setUrl(u);
    });
    return () => {
      if (u) URL.revokeObjectURL(u);
    };
  }, [blobId]);
  if (missing) return <span className="muted">audio missing</span>;
  if (!url) return <span className="muted">loading…</span>;
  return (
    <span>
      <audio controls src={url} style={{ maxWidth: "100%", verticalAlign: "middle" }} />
      {durationMs !== undefined && <span className="small muted"> {Math.round(durationMs / 1000)} s</span>}
    </span>
  );
}
