# Changelog

## 0.1.0 — full build

### Milestone 1 — schema + seed tooling
- zod schemas with derived TypeScript types and cross-field rules (lanes,
  unique ids, branch parents, profile points, table widths).
- Validation reporting file, JSON path and message; partial library load.
- Derived display numbering (`1.3`, `1A.2`), never stored.
- Markdown table parser (spec 6.4) and seed conversion CLI (spec 3.3).
- Obviously fake `demo-procedure.json`. The real seed file was not supplied,
  so no `all-engines-fail.json` is shipped.

### Milestone 2 — renderer + library
- Library: search (title, tags, row text, notes), category/fleet/status/tag
  chips, sort by recent / alphabetical / most due / weakest, cards with row
  count, open items, due count, readiness and last opened.
- Read view: wide grid table (≥ 900 px) and narrow cards, PF/PM colour plus
  text labels, callouts bold in renderer-added quotes, standing cells muted,
  verify/to-fill markers with notes, info control for why/source, sticky
  gate navigator, branch chooser (remembered per procedure), fleet filter
  applying variants, last reviewed (tap to set today), reference tables,
  profile view, focus mode (swipe/arrow keys), print stylesheet.

### Milestone 3 — annotations
- Long-press / right-click action sheet: note, highlight, tag, confidence,
  draw, voice, debrief note. Stylus touch goes straight to draw.
- Ink layer with perfect-freehand: pen, highlighter, eraser (whole stroke),
  undo, redo, clear; points stored normalised to the row box; finger scrolls
  unless finger drawing is enabled.
- Voice memos with MediaRecorder: level meter, timer, 3-minute cap,
  permission-denied message, playback from IndexedDB blobs.
- Badges per row, expand in place, global hide toggle, orphan list with
  re-attach or delete, annotations view with all filters, debrief sessions
  (active session stamps new notes; session page exports Markdown).

### Milestone 4 — edit + import/export
- Overlay model (shipped edits) and user procedures; resolution overlay →
  user → shipped; upstream-change banner with keep / take (export first) /
  row diff by id.
- Editor: every field inline, add above/below, duplicate, delete, drag
  reorder of rows and gates (pointer, touch, keyboard), move row to another
  gate, add gate, add branch, layout switch with conversion preview, bulk
  `who`, status picker, variant editor per fleet, reference tables and
  profile points, undo/redo (Ctrl/Cmd-Z), debounced autosave with
  saved/unsaved/error state, export JSON and Markdown.
- New procedure: blank, from template, import JSON (validate, summary, id
  clash with rename), import Markdown (preview and unparsable lines).

### Milestone 5 — drills + scheduling
- Scope (whole, chosen gates, one branch, due only) and role (PF/PM/both);
  standing cells and to-fill rows never drilled.
- Modes: reveal, callouts only, role play, order (drag, check, auto-grade
  0/1/2+ misplaced → Good/Hard/Again), audio (speechSynthesis, configurable
  gap and rate, pause/repeat/skip, wake lock, graded only on tap).
- ts-fsrs default parameters, one item per non-standing lane, review log,
  daily queue (due first, then new up to the limit) in role-play format,
  target date cap (global or per procedure), "ready by" share, weakness
  score for library sorting, items removed/suspended on row delete/to-fill.

### Milestone 6 — PWA + backup + settings
- vite-plugin-pwa (prompt mode): precaches app shell and `/procedures`,
  "Update available — reload" never auto-reloads, manifest with 192/512/
  maskable icons, dark theme colour.
- Backup file with every table (voice blobs as base64), restore with
  summary preview, merge (newer `updatedAt` wins) or replace; 14-day
  reminder; `navigator.storage.persist()` on first write with status and
  usage in Settings; erase all data with typed confirmation.
- Settings: theme, text size, default role, audio rate/gap, daily new
  limit, finger drawing, target dates, storage, backup/restore.

### Milestone 7 — polish
- Open items page with jump links and "mark ok" (undoable).
- Sessions, profile view, print stylesheet, ARIA labels on icon buttons,
  visible focus, 44 px targets, keyboard drag via dnd-kit.
- Performance (Playwright, headless desktop): 200 procedures × 60 rows,
  library ≈ 110 ms, procedure open ≈ 130 ms including navigation and
  IndexedDB read. No virtualisation was needed at this size.

### Tests
- 68 unit tests: schema (good/bad), numbering, loader, Markdown import,
  variant resolution, overlay diff and resolution, annotation orphaning and
  re-attach, order-drill grading, target-date cap, weakness/readiness,
  backup round-trip and merge, edit model, export/import.
- 5 Playwright flows: offline annotations + branch + reload; airplane-mode
  cold start; edit/reorder/export/re-import; role-play drill → review queue;
  200-procedure restore and open timing.

## Decisions the spec did not cover
1. A lane cell counts as "completely empty" only with no action, no callout
   and not standing; callout-only cells are allowed.
2. Element ids are validated as non-empty, whitespace-free strings (nanoid
   is used for new ids) so hand-written fixtures stay valid.
3. Branch gates are numbered parent number + letter (`1A`, `1B`), rows
   `1A.1`. Branches of a deleted gate become main gates with a renamed title.
4. Markdown import: `who` matched case-insensitively, empty `Who` becomes
   `UNASSIGNED`, unknown values are reported; a table with an unrecognised
   header is skipped as a whole; branch metadata cannot be expressed in
   Markdown and is set in the editor afterwards; rows imported with an empty
   cell are marked `to-fill` rather than invented.
5. Seed converter markers (`verify`, `to fill`) are matched case-insensitively
   anywhere in a cell; bracketed text after the marker becomes `statusNote`.
   This guesses the seed format and should be checked against the real file.
6. Version bump: autosave is debounced; the version rises once per editing
   session (loaded version + 1) rather than on every keystroke. "Mark ok" on
   the open-items page also bumps. Setting "last reviewed" does not.
7. Layout conversion: two-lane → single-lane merges both lanes into one
   action with `who: BOTH` when both have content; single-lane → two-lane
   fills the named lane and marks the row `to-fill` for the missing lane.
8. Order drill works on one gate: the first gate in scope with two or more
   rows. Grading applies to every drilled lane of that gate.
9. "New" items in the review queue are counted from today's log entries whose
   state was `New`; the daily limit is a cap on first-time reviews per day.
10. Review items are created on first grade, not pre-created, so a row that
    is never drilled has no record.
11. Target-date cap: a due date beyond the final 3-day window is pulled to
    the window start; inside the window it is capped at the target; after the
    target no cap applies.
12. Highlights apply to the whole row (the latest one wins visually); lane
    targeting is stored for notes only.
13. Deleting a user procedure or discarding an overlay exports the JSON first,
    then removes it; review data is deleted with a user procedure, annotations
    are kept as orphans.
14. Dependencies added beyond the spec list (all MIT or Apache-2.0, no keys):
    `dexie-react-hooks`, `nanoid`, `tsx` (dev), `fake-indexeddb` (dev),
    `@playwright/test` (dev). Routing is a small hand-written hash router.
15. The service worker claims clients on first install (`clientsClaim`) so a
    single visit is enough for an offline cold start; updates still wait for
    the user's "Reload".
