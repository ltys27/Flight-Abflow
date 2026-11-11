# Flow Scripts

Personal, offline-first PWA for studying A320 abnormal procedures written as
PF/PM flow scripts. Built from `SPEC.md` (the build specification).

## Develop

```
npm install
npm run dev        # Vite dev server
npm test           # Vitest
npm run typecheck  # tsc -b
npm run build      # production build in dist/
```

## Content

Procedures live in `public/procedures/`. `index.json` lists them; each
procedure is one JSON file validated against `src/content/schema.ts`.
The app ships no real procedure content: `demo-procedure.json` is an
obviously fake placeholder.

### Converting the seed

Put the source Markdown in `seed/` and run:

```
npm run convert-seed -- seed/all-engines-fail.md all-engines-fail "<title>" ENG fleets=CEO,NEO,A321
```

The converter applies the Markdown import rules (spec 6.4) and the seed
status rules (spec 3.3), prints every status decision and every line it
could not parse, validates the result, and writes
`public/procedures/all-engines-fail.json`. Add the entry to `index.json`
by hand afterwards.
