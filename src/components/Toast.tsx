import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";

interface ToastMsg {
  id: number;
  text: string;
  action?: { label: string; run: () => void };
}
interface ToastApi {
  show: (text: string, action?: ToastMsg["action"], ms?: number) => void;
}
const Ctx = createContext<ToastApi>({ show: () => undefined });

export function ToastProvider({ children }: { children: ReactNode }) {
  const [msg, setMsg] = useState<ToastMsg | null>(null);
  const timer = useRef<number | null>(null);
  const show = useCallback<ToastApi["show"]>((text, action, ms = action ? 8000 : 3000) => {
    if (timer.current) window.clearTimeout(timer.current);
    const id = Date.now();
    setMsg({ id, text, action });
    timer.current = window.setTimeout(() => setMsg((m) => (m?.id === id ? null : m)), ms);
  }, []);
  useEffect(() => () => {
    if (timer.current) window.clearTimeout(timer.current);
  }, []);
  return (
    <Ctx.Provider value={{ show }}>
      {children}
      {msg && (
        <div className="toast" role="status" aria-live="polite">
          <span>{msg.text}</span>
          {msg.action && (
            <button
              type="button"
              className="btn small primary"
              onClick={() => {
                msg.action?.run();
                setMsg(null);
              }}
            >
              {msg.action.label}
            </button>
          )}
        </div>
      )}
    </Ctx.Provider>
  );
}

export const useToast = () => useContext(Ctx);
