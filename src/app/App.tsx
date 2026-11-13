import { useEffect, type ReactNode } from "react";
import { LibraryProvider } from "../state/LibraryProvider";
import { ToastProvider } from "../components/Toast";
import { useRoute, href } from "./router";
import { useSettings } from "../state/settings";
import { LibraryScreen } from "../screens/LibraryScreen";
import { ReadScreen } from "../screens/ReadScreen";
import { EditScreen } from "../screens/EditScreen";
import { DrillScreen } from "../screens/DrillScreen";
import { ReviewScreen } from "../screens/ReviewScreen";
import { OpenItemsScreen } from "../screens/OpenItemsScreen";
import { AnnotationsScreen } from "../screens/AnnotationsScreen";
import { SessionsScreen, SessionScreen } from "../screens/SessionsScreen";
import { SettingsScreen } from "../screens/SettingsScreen";
import { NewProcedureScreen } from "../screens/NewProcedureScreen";
import { UpdatePrompt } from "./UpdatePrompt";
import { BackupReminder } from "../backup/BackupReminder";
import { useAutoSync } from "../sync/useAutoSync";

function ThemeApplier({ children }: { children: ReactNode }) {
  const s = useSettings();
  useEffect(() => {
    const root = document.documentElement;
    const apply = () => {
      const sys = window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
      root.dataset.theme = s.theme === "system" ? sys : s.theme;
      root.dataset.text = s.textSize;
      const meta = document.querySelector('meta[name="theme-color"]');
      meta?.setAttribute("content", root.dataset.theme === "light" ? "#ffffff" : "#111318");
    };
    apply();
    const mq = window.matchMedia("(prefers-color-scheme: light)");
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, [s.theme, s.textSize]);
  return <>{children}</>;
}

const NAV: Array<{ to: string; label: string; ico: string; match: string[] }> = [
  { to: href.library(), label: "Library", ico: "▤", match: ["library", "read", "edit", "drill", "new"] },
  { to: href.review(), label: "Review", ico: "◔", match: ["review"] },
  { to: href.openItems(), label: "Open", ico: "◍", match: ["open-items"] },
  { to: href.annotations(), label: "Notes", ico: "✎", match: ["annotations", "sessions", "session"] },
  { to: href.settings(), label: "Settings", ico: "⚙", match: ["settings"] },
];

function AutoSync() {
  useAutoSync();
  return null;
}

export function App() {
  const route = useRoute();
  let screen: ReactNode;
  switch (route.name) {
    case "library": screen = <LibraryScreen />; break;
    case "read": screen = <ReadScreen id={route.id} key={route.id} />; break;
    case "edit": screen = <EditScreen id={route.id} key={route.id} />; break;
    case "drill": screen = <DrillScreen id={route.id} key={route.id} />; break;
    case "review": screen = <ReviewScreen />; break;
    case "open-items": screen = <OpenItemsScreen />; break;
    case "annotations": screen = <AnnotationsScreen />; break;
    case "sessions": screen = <SessionsScreen />; break;
    case "session": screen = <SessionScreen id={route.id} key={route.id} />; break;
    case "settings": screen = <SettingsScreen />; break;
    case "new": screen = <NewProcedureScreen />; break;
  }
  const immersive = route.name === "drill" || route.name === "edit";
  return (
    <LibraryProvider>
      <ToastProvider>
        <ThemeApplier>
          <div className="app">
            {!immersive && (
              <nav className="bottomnav" aria-label="Main">
                {NAV.map((n) => (
                  <a key={n.to} href={n.to} aria-current={n.match.includes(route.name) ? "page" : undefined}>
                    <span className="ico" aria-hidden="true">{n.ico}</span>
                    <span>{n.label}</span>
                  </a>
                ))}
              </nav>
            )}
            <div className="content">{screen}</div>
            <UpdatePrompt />
            <BackupReminder />
            <AutoSync />
          </div>
        </ThemeApplier>
      </ToastProvider>
    </LibraryProvider>
  );
}
