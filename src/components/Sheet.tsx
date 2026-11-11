import { useEffect, useRef, type ReactNode } from "react";

/** Bottom sheet on phones, centred dialog on wider screens. Closes on Escape and backdrop tap. */
export function Sheet({ title, onClose, children, labelledBy }: { title?: string; onClose: () => void; children: ReactNode; labelledBy?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    const first = ref.current?.querySelector<HTMLElement>("input, textarea, select, button, [tabindex]");
    first?.focus();
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="sheet-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title} aria-labelledby={labelledBy} ref={ref}>
        {title && <h2>{title}</h2>}
        {children}
      </div>
    </div>
  );
}
