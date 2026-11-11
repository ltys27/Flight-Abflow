import { useState } from "react";
import { Sheet } from "./Sheet";

/** Confirmation dialog; `typed` requires the user to type a word (erase all data). */
export function Confirm({
  title,
  message,
  confirmLabel = "Confirm",
  danger,
  typed,
  onConfirm,
  onCancel,
}: {
  title: string;
  message: string;
  confirmLabel?: string;
  danger?: boolean;
  typed?: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const [text, setText] = useState("");
  const ok = !typed || text === typed;
  return (
    <Sheet title={title} onClose={onCancel}>
      <p>{message}</p>
      {typed && (
        <label className="field">
          <span>Type {typed} to confirm</span>
          <input type="text" value={text} onChange={(e) => setText(e.target.value)} autoComplete="off" />
        </label>
      )}
      <div className="row-actions">
        <button type="button" className={`btn ${danger ? "danger" : "primary"}`} disabled={!ok} onClick={onConfirm}>
          {confirmLabel}
        </button>
        <button type="button" className="btn" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </Sheet>
  );
}
