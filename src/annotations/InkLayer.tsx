import { useEffect, useRef, useState } from "react";
import { getStroke } from "perfect-freehand";
import type { Stroke } from "./types";

type Tool = "pen" | "highlighter" | "eraser";

function toPath(outline: number[][]): string {
  if (outline.length === 0) return "";
  const [first, ...rest] = outline;
  let d = `M ${first![0]!.toFixed(2)} ${first![1]!.toFixed(2)}`;
  for (const [x, y] of rest) d += ` L ${x!.toFixed(2)} ${y!.toFixed(2)}`;
  return d + " Z";
}

/** Render strokes whose points are normalised 0..1 into a box of w×h px. */
export function StrokePaths({ strokes, w, h }: { strokes: Stroke[]; w: number; h: number }) {
  return (
    <>
      {strokes.map((s, i) => {
        const pts = s.points.map(([x, y, p]) => [x * w, y * h, p]);
        const outline = getStroke(pts, {
          size: s.size,
          thinning: s.tool === "highlighter" ? 0 : 0.5,
          smoothing: 0.5,
          streamline: 0.5,
          simulatePressure: pts.every(([, , p]) => p === 0.5),
        });
        return <path key={i} d={toPath(outline)} fill={s.color} opacity={s.tool === "highlighter" ? 0.4 : 1} />;
      })}
    </>
  );
}

/**
 * Transparent drawing layer sized to its parent row. Points are stored
 * normalised to the row box so strokes survive reflow and rotation (spec 5).
 * Finger scrolls, stylus draws; `fingerDrawing` lets fingers draw too.
 */
export function InkLayer({
  strokes,
  active,
  fingerDrawing,
  onChange,
  onDone,
}: {
  strokes: Stroke[];
  active: boolean;
  fingerDrawing: boolean;
  onChange: (strokes: Stroke[]) => void;
  onDone: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 1, h: 1 });
  const [tool, setTool] = useState<Tool>("pen");
  const [color, setColor] = useState("#ff5252");
  const [current, setCurrent] = useState<Stroke | null>(null);
  const [undone, setUndone] = useState<Stroke[]>([]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth || 1, h: el.clientHeight || 1 }));
    ro.observe(el);
    setSize({ w: el.clientWidth || 1, h: el.clientHeight || 1 });
    return () => ro.disconnect();
  }, []);

  const norm = (e: React.PointerEvent): [number, number, number] => {
    const r = ref.current!.getBoundingClientRect();
    return [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height, e.pressure || 0.5];
  };
  const allowed = (e: React.PointerEvent) => e.pointerType !== "touch" || fingerDrawing;

  const onDown = (e: React.PointerEvent) => {
    if (!active || !allowed(e)) return;
    e.preventDefault();
    (e.target as Element).setPointerCapture?.(e.pointerId);
    if (tool === "eraser") {
      eraseAt(e);
      return;
    }
    setCurrent({
      points: [norm(e)],
      color: tool === "highlighter" ? "#ffd600" : color,
      size: tool === "highlighter" ? 18 : 4,
      tool,
    });
  };
  const onMove = (e: React.PointerEvent) => {
    if (!active || !allowed(e)) return;
    if (tool === "eraser" && e.buttons) {
      eraseAt(e);
      return;
    }
    if (!current) return;
    e.preventDefault();
    setCurrent({ ...current, points: [...current.points, norm(e)] });
  };
  const onUp = () => {
    if (!current) return;
    if (current.points.length > 1) {
      onChange([...strokes, current]);
      setUndone([]);
    }
    setCurrent(null);
  };
  const eraseAt = (e: React.PointerEvent) => {
    const [x, y] = norm(e);
    const hit = strokes.findIndex((s) => s.points.some(([px, py]) => Math.hypot((px - x) * size.w, (py - y) * size.h) < 12));
    if (hit >= 0) {
      setUndone((u) => [...u, strokes[hit]!]);
      onChange(strokes.filter((_, i) => i !== hit));
    }
  };
  const undo = () => {
    if (strokes.length === 0) return;
    setUndone((u) => [...u, strokes[strokes.length - 1]!]);
    onChange(strokes.slice(0, -1));
  };
  const redo = () => {
    const s = undone[undone.length - 1];
    if (!s) return;
    setUndone((u) => u.slice(0, -1));
    onChange([...strokes, s]);
  };

  return (
    <>
      <div
        ref={ref}
        className={`ink-layer${active ? " active" : ""}`}
        aria-hidden={!active}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
      >
        <svg viewBox={`0 0 ${size.w} ${size.h}`} preserveAspectRatio="none" role={active ? "img" : undefined} aria-label={active ? "Drawing area" : undefined}>
          <StrokePaths strokes={current ? [...strokes, current] : strokes} w={size.w} h={size.h} />
        </svg>
      </div>
      {active && (
        <div className="row-actions no-print" role="toolbar" aria-label="Drawing tools" style={{ marginTop: 6 }}>
          {(["pen", "highlighter", "eraser"] as Tool[]).map((t) => (
            <button key={t} type="button" className={`btn small${tool === t ? " active" : ""}`} aria-pressed={tool === t} onClick={() => setTool(t)}>
              {t}
            </button>
          ))}
          <label className="btn small" style={{ gap: 6 }}>
            <span>Colour</span>
            <input type="color" value={color} onChange={(e) => setColor(e.target.value)} aria-label="Pen colour" style={{ width: 28, height: 28, padding: 0, minHeight: 0, border: 0, background: "none" }} />
          </label>
          <button type="button" className="btn small" onClick={undo} disabled={strokes.length === 0}>Undo</button>
          <button type="button" className="btn small" onClick={redo} disabled={undone.length === 0}>Redo</button>
          <button type="button" className="btn small" onClick={() => { setUndone((u) => [...u, ...strokes]); onChange([]); }} disabled={strokes.length === 0}>Clear</button>
          <button type="button" className="btn small primary" onClick={onDone}>Done</button>
        </div>
      )}
    </>
  );
}
