import { useEffect, useState } from "react";

export function useMedia(query: string): boolean {
  const [m, setM] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const on = () => setM(mq.matches);
    mq.addEventListener("change", on);
    setM(mq.matches);
    return () => mq.removeEventListener("change", on);
  }, [query]);
  return m;
}

export const useWide = () => useMedia("(min-width: 900px)");
