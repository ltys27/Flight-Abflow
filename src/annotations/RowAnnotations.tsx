import { useState } from "react";
import { Sheet } from "../components/Sheet";
import { useToast } from "../components/Toast";
import { CONFIDENCES, HIGHLIGHT_COLORS, type Annotation, type AnnotationTarget, type Confidence, type HighlightColor } from "./types";
import { addAnnotation, deleteAnnotation, latestConfidence, restoreAnnotation, updateAnnotation } from "./store";
import { VoicePlayer, VoiceRecorder } from "./VoiceRecorder";
import { useSetting } from "../state/settings";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "../db/db";
import { href } from "../app/router";

export type SheetAction = "note" | "highlight" | "tag" | "confidence" | "draw" | "voice" | "debrief";

/** Action sheet opened by long-press / right-click on a row (spec 5). */
export function AnnotationActionSheet({
  target,
  onClose,
  onDraw,
}: {
  target: AnnotationTarget;
  onClose: () => void;
  onDraw: () => void;
}) {
  const [step, setStep] = useState<SheetAction | null>(null);
  const [text, setText] = useState("");
  const toast = useToast();
  const activeSession = useSetting("activeSessionId");
  const sessions = useLiveQuery(() => db.sessions.toArray(), [], []);
  const existingTags = useLiveQuery(async () => {
    const all = await db.annotations.where("kind").equals("tag").toArray();
    return [...new Set(all.map((a) => a.tag!).filter(Boolean))].sort();
  }, [], []);

  const done = (what: string) => {
    toast.show(`${what} added`);
    onClose();
  };

  if (step === null) {
    const items: Array<[SheetAction, string]> = [
      ["note", "Note"],
      ["highlight", "Highlight"],
      ["tag", "Tag"],
      ["confidence", "Confidence"],
      ["draw", "Draw"],
      ["voice", "Voice"],
      ["debrief", "Debrief note"],
    ];
    return (
      <Sheet title="Annotate row" onClose={onClose}>
        <div className="grid">
          {items.map(([k, label]) => (
            <button
              key={k}
              type="button"
              className="btn"
              onClick={() => {
                if (k === "draw") {
                  onDraw();
                  onClose();
                } else setStep(k);
              }}
            >
              {label}
            </button>
          ))}
        </div>
        {target.rowId && (
          <a className="btn ghost" style={{ marginTop: 8 }} href={href.edit(target.procedureId, target.rowId)} onClick={onClose}>✎ Edit this row's text</a>
        )}
      </Sheet>
    );
  }

  if (step === "note" || step === "debrief") {
    const noSession = step === "debrief" && !activeSession;
    return (
      <Sheet title={step === "debrief" ? "Debrief note" : "Note"} onClose={onClose}>
        {noSession && (
          <p className="banner warn">
            No debrief session is active. Start one on the Sessions page; until then this is saved as a plain note.
          </p>
        )}
        {step === "debrief" && activeSession && (
          <p className="small muted">Session: {sessions.find((s) => s.id === activeSession)?.name ?? activeSession}</p>
        )}
        <label className="field">
          <span>Text</span>
          <textarea value={text} onChange={(e) => setText(e.target.value)} />
        </label>
        <div className="row-actions">
          <button
            type="button"
            className="btn primary"
            disabled={!text.trim()}
            onClick={async () => {
              await addAnnotation({ target, kind: "note", text: text.trim(), ...(step === "debrief" && activeSession ? { sessionId: activeSession } : {}) });
              done("Note");
            }}
          >
            Save
          </button>
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
        </div>
      </Sheet>
    );
  }

  if (step === "highlight") {
    return (
      <Sheet title="Highlight" onClose={onClose}>
        <div className="grid">
          {HIGHLIGHT_COLORS.map((c) => (
            <button key={c} type="button" className={`btn hl-${c}`} onClick={async () => { await addAnnotation({ target, kind: "highlight", color: c }); done("Highlight"); }}>
              {c}
            </button>
          ))}
        </div>
      </Sheet>
    );
  }

  if (step === "tag") {
    return (
      <Sheet title="Tag" onClose={onClose}>
        <label className="field">
          <span>Tag</span>
          <input type="text" list="existing-tags" value={text} onChange={(e) => setText(e.target.value)} />
          <datalist id="existing-tags">
            {existingTags.map((t) => (
              <option key={t} value={t} />
            ))}
          </datalist>
        </label>
        <div className="row-actions">
          <button type="button" className="btn primary" disabled={!text.trim()} onClick={async () => { await addAnnotation({ target, kind: "tag", tag: text.trim() }); done("Tag"); }}>
            Save
          </button>
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
        </div>
      </Sheet>
    );
  }

  if (step === "confidence") {
    return (
      <Sheet title="Confidence" onClose={onClose}>
        <div className="grid">
          {CONFIDENCES.map((c) => (
            <button key={c} type="button" className="btn" onClick={async () => { await addAnnotation({ target, kind: "confidence", confidence: c }); done("Confidence"); }}>
              <span className={`dot ${c}`} aria-hidden="true" /> {c}
            </button>
          ))}
        </div>
      </Sheet>
    );
  }

  return (
    <Sheet title="Voice memo" onClose={onClose}>
      <VoiceRecorder
        onCancel={onClose}
        onSaved={async (blobId, durationMs) => {
          await addAnnotation({ target, kind: "voice", blobId, durationMs });
          done("Voice memo");
        }}
      />
    </Sheet>
  );
}

const KIND_LABEL: Record<Annotation["kind"], string> = {
  note: "note",
  highlight: "highlight",
  tag: "tag",
  confidence: "confidence",
  ink: "drawing",
  voice: "voice memo",
};

/** Compact badges for a row; tap a badge to expand in place (spec 5). */
export function RowBadges({ annotations, onEditInk }: { annotations: Annotation[]; onEditInk?: (a: Annotation) => void }) {
  const [open, setOpen] = useState(false);
  const toast = useToast();
  if (annotations.length === 0) return null;
  const notes = annotations.filter((a) => a.kind === "note");
  const tags = annotations.filter((a) => a.kind === "tag");
  const conf = latestConfidence(annotations);
  const ink = annotations.filter((a) => a.kind === "ink");
  const voice = annotations.filter((a) => a.kind === "voice");
  const highlights = annotations.filter((a) => a.kind === "highlight");

  const remove = async (a: Annotation) => {
    const removed = await deleteAnnotation(a.id);
    if (removed) toast.show(`${KIND_LABEL[a.kind]} deleted`, { label: "Undo", run: () => void restoreAnnotation(removed) });
  };

  return (
    <div className="no-print">
      <div className="row-badges">
        {notes.length > 0 && (
          <button type="button" className="badge" aria-expanded={open} onClick={() => setOpen(!open)}>
            ✎ {notes.length} {notes.length === 1 ? "note" : "notes"}
          </button>
        )}
        {tags.map((t) => (
          <button key={t.id} type="button" className="badge" aria-expanded={open} onClick={() => setOpen(!open)}>
            #{t.tag}
          </button>
        ))}
        {conf && (
          <button type="button" className={`badge conf-${conf}`} aria-expanded={open} onClick={() => setOpen(!open)}>
            <span className={`dot ${conf}`} aria-hidden="true" /> {conf}
          </button>
        )}
        {ink.length > 0 && (
          <button type="button" className="badge" aria-expanded={open} onClick={() => setOpen(!open)} aria-label="Drawing">
            ✏ drawing
          </button>
        )}
        {voice.length > 0 && (
          <button type="button" className="badge" aria-expanded={open} onClick={() => setOpen(!open)}>
            ● {voice.length} voice
          </button>
        )}
        {highlights.length > 0 && !notes.length && !tags.length && !conf && !ink.length && !voice.length && (
          <button type="button" className="badge" aria-expanded={open} onClick={() => setOpen(!open)}>
            highlight
          </button>
        )}
      </div>
      {open && (
        <div className="row-expanded">
          {annotations
            .filter((a) => a.kind !== "ink")
            .map((a) => (
              <AnnotationItem key={a.id} a={a} onDelete={() => void remove(a)} />
            ))}
          {ink.map((a) => (
            <div key={a.id} className="note-item">
              <span className="text">Drawing ({a.strokes?.length ?? 0} strokes)</span>
              {onEditInk && <button type="button" className="btn small" onClick={() => onEditInk(a)}>Edit</button>}
              <button type="button" className="btn small" onClick={() => void remove(a)} aria-label="Delete drawing">Delete</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function AnnotationItem({ a, onDelete, extra }: { a: Annotation; onDelete: () => void; extra?: React.ReactNode }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(a.text ?? "");
  return (
    <div className="note-item">
      <div className="text">
        {a.kind === "note" && !editing && <span>{a.text}</span>}
        {a.kind === "note" && editing && (
          <div>
            <textarea value={text} onChange={(e) => setText(e.target.value)} aria-label="Edit note" />
            <div className="row-actions">
              <button type="button" className="btn small primary" onClick={async () => { await updateAnnotation(a.id, { text }); setEditing(false); }}>Save</button>
              <button type="button" className="btn small" onClick={() => setEditing(false)}>Cancel</button>
            </div>
          </div>
        )}
        {a.kind === "highlight" && <span className={`chip tiny hl-${a.color as HighlightColor}`}>highlight: {a.color}</span>}
        {a.kind === "tag" && <span className="chip tiny">#{a.tag}</span>}
        {a.kind === "confidence" && <span><span className={`dot ${a.confidence as Confidence}`} aria-hidden="true" /> confidence: {a.confidence}</span>}
        {a.kind === "voice" && a.blobId && <VoicePlayer blobId={a.blobId} durationMs={a.durationMs} />}
        <div className="small muted">
          {new Date(a.updatedAt).toLocaleString()}
          {a.sessionId && <SessionName id={a.sessionId} />}
        </div>
        {extra}
      </div>
      {a.kind === "note" && !editing && <button type="button" className="btn small" onClick={() => setEditing(true)}>Edit</button>}
      <button type="button" className="btn small" onClick={onDelete} aria-label={`Delete ${KIND_LABEL[a.kind]}`}>Delete</button>
    </div>
  );
}

function SessionName({ id }: { id: string }) {
  const s = useLiveQuery(() => db.sessions.get(id), [id]);
  return <> · session: {s?.name ?? "(deleted)"}</>;
}
