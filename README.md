# Irene Family Tree

Interactive viewer for a GEDCOM family tree. Parses `family-tree.ged` into a
static JSON dataset at build time; the UI is a Next.js app using React Flow
and Dagre.

## Local development

```bash
npm install
npm run dev
```

The `dev` script runs `build:data` first, which parses `family-tree.ged` and
writes `src/data/tree.json`. Re-run `npm run build:data` after editing the
GEDCOM.

## Production build

```bash
npm run build   # prebuild hook runs build:data automatically
npm start
```

## Deploy

No database. Push to Vercel and it works — the dataset is bundled with the app.
