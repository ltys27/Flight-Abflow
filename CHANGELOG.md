# Changelog

## Milestone 1 — Schema + seed (in progress: seed file not yet supplied)

### Added
- Vite + React + TypeScript (strict) project scaffold; Vitest + Testing Library.
- `src/content/schema.ts`: zod schemas for `Procedure`, `Gate`, `Row`,
  `LaneCell`, `RowOverride`, `ReferenceTable`, `ProfilePoint` and the
  procedure index. TypeScript types are derived from the schemas.
  Cross-field rules: two-lane rows need both lanes and no completely empty
  cell unless `to-fill`; single-lane rows need `action` and `who`; lane
  fields and single-lane fields are mutually exclusive; gate/row/table ids
  unique; branch parents and profile points reference existing gates;
  reference-table rows match the column count; no self-relation.
- `src/content/validate.ts`: validation that reports file, JSON path and
  message, including JSON syntax errors.
- `src/content/library.ts`: shipped-library loader; a bad file is reported
  and the rest of the library still loads.
- `src/content/numbering.ts`: derived display numbers (`1.3`, `1A.2`).
- `src/import/markdown.ts`: Markdown table parser per spec 6.4 (both table
  shapes, bold-as-callout, `#` column ignored, unparsable lines reported).
- `scripts/convert-seed.ts`: CLI that converts a seed Markdown file to
  procedure JSON and applies the spec 3.3 status rules, printing each
  decision for checking.
- `public/procedures/demo-procedure.json`: obviously fake placeholder
  content exercising every schema feature; `index.json`.
- Minimal app shell that loads the library and lists validation problems.
- 37 unit tests (good and bad files, numbering, loader, Markdown import).

### Not done
- `seed/all-engines-fail.md` was not present in the repository, so
  `all-engines-fail.json` could not be produced. Run the converter once the
  file is added (see README).

### Decisions not covered by the spec
1. A lane cell counts as "completely empty" only when it has no action, no
   callout and is not standing. A callout-only cell is allowed.
2. Element ids (gates, rows, tables) are validated as non-empty strings
   without whitespace rather than strictly as nanoids, so hand-written
   fixture ids remain valid. New ids are generated with nanoid.
3. Branch gate numbering: a branch gate takes its parent's number plus a
   letter in order of appearance (`1A`, `1B`), rows `1A.1`.
4. Markdown import: `who` is matched case-insensitively; an empty `Who`
   cell becomes `UNASSIGNED`; any other value is reported as unparsable.
   `#`-level headings other than `## ` are ignored. A table with an
   unrecognised header is skipped as a whole and each of its lines listed.
5. Markdown import cannot express branch gates (`branch.parentGateId` and
   `condition`); those fields are set after import, in the editor.
6. Seed converter status markers: `verify` and `to fill` are detected
   case-insensitively anywhere in trigger/PF/PM/action cells; text in the
   same bracket after the marker becomes `statusNote` and the marker is
   removed from the cell. This needs checking against the real seed format.
7. Vite `base` is `./` so the build runs from any GitHub Pages sub-path.
8. Added `tsx` (MIT) as a dev dependency to run the converter script.
