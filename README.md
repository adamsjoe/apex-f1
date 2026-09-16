# Apex — F1 telemetry head-to-head

A Next.js (App Router, TypeScript) app. Pick a session and two drivers; it pulls each
driver's **fastest lap** from the OpenF1 API and races them as ghosts on the circuit,
with a distance-aligned delta, dual speed traces, and live throttle/brake/gear/DRS.
Data is fetched on demand through a cached API route — no files, no uploads.

Built by **Joseph Adams** · Adams Quality Engineering · [adamsqe.co.uk](https://adamsqe.co.uk)

## Run

```bash
npm install
npm run dev        # http://localhost:3000 — API route runs here too, so live matchups work
```

Production:

```bash
npm run build && npm start
```

Deploy: push to a repo and import in Vercel, or `vercel` from this folder. Zero config.

## Project structure

```
app/
  layout.tsx           root layout + fonts
  page.tsx             composes picker + replay, owns model/stage state
  globals.css          design tokens + styles
  api/f1/route.ts      cached proxy → api.openf1.org (server-side, no CORS)
lib/
  types.ts             OpenF1 + internal model types
  openf1.ts            typed client (calls /api/f1)
  pipeline.ts          fastest-lap · timestamp join · distance · interpolation · delta
  engine.ts            imperative canvas render + 60fps clock, emits snapshots
  sample.ts            bundled real lap for the offline demo
components/
  Picker.tsx           session/driver selection + fetch orchestration
  Replay.tsx           canvas + panel + transport + HUD, driven by engine snapshots
```

The 60fps render loop lives in `lib/engine.ts` (plain TS, outside React) so it never
triggers re-renders; the React chrome subscribes for throttled snapshots.

## Data pipeline

Per driver, per matchup:

1. `GET /v1/laps` → fastest lap with a valid `date_start`/`lap_duration`, not a pit-out lap.
2. Fetch `car_data` + `location` filtered to that lap's time window (only ~one lap moves).
3. Join `location` (X/Y) onto `car_data` by nearest timestamp within ±500 ms.
4. Distance from the X/Y path (OpenF1 coords are 1/10 m).
5. Catmull-Rom interpolate ~3.7 Hz → 60 fps; delta aligned on distance.

Validated against real OpenF1 bytes before the UI was built (Leclerc's fastest lap,
Singapore 2023: 348 merged points, 4835 m).

## Caching

`app/api/f1/route.ts` forwards whitelisted requests to OpenF1 server-side and sets
`Cache-Control: s-maxage=86400, stale-while-revalidate` (plus `next: { revalidate }` on
the upstream fetch). Historical data is immutable, so repeat matchups are served from
Vercel's edge cache; the client also memoises within a page.

## Notes

- The pipeline HUD shows real source, join tolerance, point counts and interpolation
  method, with a **LIVE · OPENF1** vs **OFFLINE SAMPLE** badge. The bundled demo lap is
  genuine OpenF1 data, correctly attributed — nothing synthetic is shown as real.
- OpenF1 is an unofficial API, not associated with Formula 1.

## Roadmap

- Playwright visual-regression on the paused/seeded state.
- `@axe-core` accessibility pass and Lighthouse in CI.
