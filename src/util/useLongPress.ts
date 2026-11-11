import { useRef } from "react";

export interface PressInfo {
  x: number;
  y: number;
  pointerType: string;
}

/**
 * Long-press (touch/pen, 500 ms) or right-click (pointer) opens an action
 * sheet (spec 5). A stylus touch calls `onStylus` immediately when given.
 */
export function useLongPress(onOpen: (info: PressInfo) => void, onStylus?: (info: PressInfo) => void, ms = 500) {
  const timer = useRef<number | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  const clear = () => {
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = null;
    start.current = null;
  };
  return {
    onPointerDown: (e: React.PointerEvent) => {
      if (e.button !== 0) return;
      const info = { x: e.clientX, y: e.clientY, pointerType: e.pointerType };
      if (e.pointerType === "pen" && onStylus) {
        onStylus(info);
        return;
      }
      if (e.pointerType === "mouse") return;
      start.current = { x: e.clientX, y: e.clientY };
      timer.current = window.setTimeout(() => {
        timer.current = null;
        onOpen(info);
      }, ms);
    },
    onPointerMove: (e: React.PointerEvent) => {
      if (!start.current) return;
      if (Math.hypot(e.clientX - start.current.x, e.clientY - start.current.y) > 10) clear();
    },
    onPointerUp: clear,
    onPointerCancel: clear,
    onPointerLeave: clear,
    onContextMenu: (e: React.MouseEvent) => {
      e.preventDefault();
      clear();
      onOpen({ x: e.clientX, y: e.clientY, pointerType: "mouse" });
    },
  };
}
