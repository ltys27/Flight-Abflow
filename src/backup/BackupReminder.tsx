import { useSettings } from "../state/settings";
import { href } from "../app/router";
import { useRoute } from "../app/router";

/** Remind to back up when the last backup is older than 14 days and data changed (spec 9). */
export function BackupReminder() {
  const s = useSettings();
  const route = useRoute();
  if (route.name !== "library") return null;
  if (!s.lastDataChangeAt) return null;
  const last = s.lastBackupAt ? new Date(s.lastBackupAt).getTime() : 0;
  const changedSince = !s.lastBackupAt || s.lastDataChangeAt > s.lastBackupAt;
  const old = Date.now() - last > 14 * 86_400_000;
  if (!(changedSince && old)) return null;
  return (
    <div className="banner warn" style={{ margin: "0 16px" }} role="status">
      {s.lastBackupAt ? "Your last backup is older than 14 days and data has changed since." : "You have data that has never been backed up."}{" "}
      <a href={href.settings()}>Back up now</a>
    </div>
  );
}
