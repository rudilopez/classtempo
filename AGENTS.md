# AGENTS.md — working on MixDeck

MixDeck is a **phone- and iPad-first web DJ app** (installable PWA), live at https://rudilopez.github.io/mixdeck/.
The owner uses it on an iPhone as a Home Screen app. Start with [docs/HANDOFF.md](docs/HANDOFF.md) — it lists the
open work in priority order — then README.md and docs/ARCHITECTURE.md.

## Commands

```bash
npm install          # once
npm run dev          # Vite dev server (apps/web) on http://localhost:5173
npm run typecheck    # tsc --noEmit in every workspace
npm test             # Vitest (all workspaces)
npm run build        # production build to apps/web/dist (emits sw.js)
```

All three of typecheck / test / build must pass before every commit.

## Layout

- `apps/web` — Vite 6 + React 19 + TypeScript (strict, `noUncheckedIndexedAccess`). `src/dancer/` Dancer mode,
  `src/components/` DJ mode, `src/platform/` mobile-platform helpers (audio session, keep-alive, Media Session,
  wake lock, interruption recovery, cue navigation/labels) with Vitest tests.
- `packages/engine` — Web Audio engine: `Engine`, `Deck` (DJ, AudioWorklet), `StretchDeck` (key-locked player via
  `signalsmith-stretch`), `VideoDeck` (native `<video>` with `preservesPitch`), `DancerPlayer` interface.
- `packages/analysis` — BPM / beatgrid / waveform peaks (pure functions, run in a Worker).
- `packages/library`, `packages/midi` — typed scaffolds for later phases.
- `docs/` — VISION_AND_PARITY, ARCHITECTURE, BUILD_PLAN, HANDOFF.

## Rules

- Phone first: every UI change must work at 360×780, 390×844, 430×932 (portrait), 844×390 (landscape) and iPad
  768×1024 / 1180×820 / 1366×1024 with no horizontal overflow; Dancer mode must fit without scrolling in phone
  portrait. Touch targets ≥ 44 px, cue pads ≥ 72 px. Respect safe-area insets.
- Cross-platform: iPhone/iPad Safari and Android Chrome. Feature-detect every API, degrade silently, nothing
  brand-specific (no "AirPods" wording — say "lock-screen and headphone controls").
- Audio can only start from a user gesture on iOS: call `play()` / `engine.unlock()` / `keepAlive.start()`
  synchronously inside the handler, before any `await`.
- Keep the cue storage key `mixdeck.dancer.cues.<name>|<duration.toFixed(2)>` stable — users have saved cues.
- Style: 2-space indent, single quotes, trailing commas, short doc comments, explicit types on exported API, no `any`.
- Don't add dependencies without a reason written in the commit message. Don't commit `test-media/` or `.claude/`.
- Deploy = push to `main` (GitHub Actions: typecheck → test → build → Pages). Work on a branch; merge to `main`
  only when checks pass. Commit messages: imperative summary + bullet body.
