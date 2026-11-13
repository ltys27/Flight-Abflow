# Flow Scripts

Personal, offline-first PWA for studying A320 abnormal procedures written as
PF/PM flow scripts, with annotations, drills and spaced review.
Built from `SPEC.md`. Everything stays on the device: no backend, accounts,
analytics or third-party calls.

## Develop

```
npm install
npm run dev          # Vite dev server
npm run typecheck    # tsc -b
npm test             # Vitest unit tests
npm run test:e2e     # Playwright end-to-end (builds, then serves dist on :4173)
npm run build        # production build with service worker in dist/
```

If Playwright's own browser download is not available, point it at a
Chromium binary: `PW_CHROMIUM_PATH=/path/to/chrome npm run test:e2e`.

Deploy by publishing `dist/` to any static host (GitHub Pages works without
rewrites: routing is hash-based and the build uses a relative base).

## Content

Procedures live in `public/procedures/`. `index.json` lists them; each
procedure is one JSON file validated against the zod schema in
`src/content/schema.ts`. A file that fails validation is reported in the
library with file, JSON path and message, and the rest still loads.

**The app ships no real procedure content.** `demo-procedure.json` is an
obviously fake placeholder that exercises every schema feature. Real
content comes from you, through any of:

- **New procedure** in the app: blank, or duplicate an existing one as a
  template (structure kept, content cleared), then edit.
- **Import Markdown** (`#/new`): `## ` headings become gates; a table with
  header `# | Trigger | PF | PM` becomes a two-lane gate, `# | Trigger |
  Action | Who` a single-lane gate; bold text in a cell is the callout.
  Lines that cannot be parsed are listed before you apply.
- **Import JSON** (`#/new`): a file in the schema, validated and previewed.
- **Seed conversion** on the command line, for a Markdown source:

  ```
  npm run convert-seed -- seed/all-engines-fail.md all-engines-fail "<title>" ENG fleets=CEO,NEO,A321
  ```

  It applies the Markdown rules above plus the status rules of spec 3.3
  (`verify` and `to fill` markers become row statuses with the remark in
  `statusNote`; rows with both lanes empty become `to-fill`), prints every
  decision and unparsable line, validates, and writes
  `public/procedures/<id>.json`. Add the entry to `index.json` by hand.

Edits to shipped procedures are stored as an overlay in IndexedDB and never
touch the shipped file. When a shipped file's `version` rises above the
overlay's base, the read view offers keep mine / take shipped (yours is
exported first) / review a row-by-row diff.

## Sync between devices (optional)

Settings → "Sync with a GitHub repository". Create a **private** repository
and a fine-grained personal access token restricted to it with
*Contents: read and write*. Enter `owner/name`, branch, a folder, and the
token, then Test connection and Sync now. The app keeps one `data.json` in
that folder plus one file per voice memo under `blobs/`, merges newer
changes per record and honours deletions. The token stays on the device.

## Where things are

| Area | Files |
| --- | --- |
| Schema, validation, numbering, resolution | `src/content/` |
| Markdown parser | `src/import/markdown.ts` |
| Storage (Dexie), settings, procedures, sessions | `src/db/`, `src/state/` |
| Annotations (notes, highlights, tags, confidence, ink, voice) | `src/annotations/` |
| Editor model, import/export, diff | `src/edit/` |
| Drill modes and item building | `src/drill/` |
| FSRS scheduling, target-date cap, stats | `src/schedule/` |
| Backup / restore / erase | `src/backup/` |
| Screens | `src/screens/` |
| Unit tests / end-to-end tests | `tests/`, `tests/e2e/` |
