# AGENTS.md — working on ClassTempo

ClassTempo is the working name for a **phone- and iPad-first dance teaching player**, installed as a PWA.
One song or video plays at a time. The former DJ/mixing roadmap is retired. The repository/package names and
live URL remain `mixdeck`: https://rudilopez.github.io/mixdeck/.

Read README.md, docs/BUILD_PLAN.md and docs/ARCHITECTURE.md for current behavior. docs/HANDOFF.md and
its linked reports preserve historical requests and acceptance evidence; historical DJ tasks are not current scope.
The owner uses the installed app on an iPhone. Desktop tests do not establish iPhone acceptance.

## Commands

```bash
npm install          # once
npm run dev          # Vite on http://localhost:5173
npm run typecheck    # tsc --noEmit in every workspace
npm test             # Vitest across workspaces
npm run build        # apps/web/dist, including sw.js
```

All three of typecheck / test / build must pass before every commit. Verify the relevant real browser flow as
well; for phone-only behavior, record the limitation and keep physical-device acceptance separate.

## Layout

- `apps/web/src/dancer` — the single player, cues, native video and Stage; the directory name is historical.
- `apps/web/src/practice` — section repeat/delay controller, settings normalization/persistence and editor.
- `apps/web/src/library` — IndexedDB file library, recents, ordered class sets and settings backup/restore.
- `apps/web/src/platform` — audio session recovery, keep-alive, Media Session and wake lock helpers/tests.
- `packages/engine` — shared AudioContext, `StretchDeck`, `VideoDeck`, `DancerPlayer`; legacy DJ code also remains.
- `packages/analysis` — pure audio BPM/beat-grid/waveform analysis, executed in a Worker.
- `packages/library`, `packages/midi`, legacy DJ components — scaffolds/legacy code, not current product UI.
- `docs/APPLE_MUSIC_FEASIBILITY.md` — separate integration gate; credentials and actual device tests are required.

## Rules

- Phone first: check 360×780, 390×844, 430×932 portrait; 844×390 landscape; and iPad 768×1024, 1180×820,
  1366×1024. No horizontal overflow. The main portrait player fits without page scrolling; library/practice
  dialogs scroll internally. Touch targets remain at least 44 px and cue pads at least 72 px, including compact
  Stage layouts. Respect safe areas.
- One player only: Open accepts audio/video and detects the actual file type. Library Add saves the selection
  and opens its first file paused. Picker cancellation preserves the track; class advancement is manual.
- Library has Media (all saved songs and videos) and Classes (ordered teaching plans). Search filters saved media, never music services. Failed saves may still
  open directly, with explicit unsaved feedback; Save current must preserve playback and practice settings.
- Production uses `Engine.create({ dj: false })`. Do not initialize hidden DJ decks/processors as a side effect.
- Cross-platform: feature-detect APIs and degrade honestly. Use generic wording such as lock-screen/headphone
  controls. Never claim physical iPhone playback, timer or lock-screen acceptance from desktop WebKit alone.
- iOS gesture rules: call `play()` / `engine.unlock()` / `keepAlive.start()` synchronously inside the gesture,
  before any `await`. A delayed first native-video start is not reliable; preserve the first-Play permission path.
- Preserve one native video element through Stage. Do not decode the full video's audio for analysis or waveform.
- Cancel pending practice work before loads, manual seeks, pauses, cue launches and teardown. Delayed callbacks
  must not revive an old track. Practice sections are rehearsal controls, not sample-accurate loops.
- Keep cue keys `mixdeck.dancer.cues.<name>|<duration.toFixed(2)>` stable. Practice keys use
  `mixdeck.practice.<name>|<duration.toFixed(2)>`. The product rename must not erase existing saved work.
- Preserve independent per-exercise snapshots and repeated entries in class sets. Selecting a snapshot does not
  overwrite a file's default merely by loading it. Validate imported settings against actual track duration.
- Save File/Blob and library metadata atomically. A successful load is not a successful offline save. Report
  failures; a metadata backup never proves the media exists. Browser storage may be evicted or cleared.
- Empty cue pads set the current position with one tap; changing an existing cue requires Edit. Preserve Undo.
  Practice footer actions must commit the visible range directly; no separate Add-section prerequisite. A cue
  inside an active range keeps repeating; leaving it must visibly explain the switch to full-track playback.
  Named practices retain independent playback snapshots. End practice cancels timers, pauses at the current
  position and disables the active delay/mode without deleting presets; returning to Play must not revive a pass.
  Dialogs contain focus, restore background inert state and prevent global player shortcuts while open.
- Apple Music/Spotify are not integrated. Do not add a fake connection button or promise streaming feature parity.
  Apple Music feasibility awaits credentials. Stems stay hidden research with existing weight/device gates;
  no model auto-download or server fallback is authorized by the classroom feature scope.
- Style: 2-space indent, single quotes, trailing commas, explicit exported API types, no `any`.
- Do not add dependencies without a reason documented in the commit. Do not commit `test-media/`, `.claude/`,
  credentials, user media or private backup files.
- Preserve Vite's ES2022 target and Signalsmith pre-bundling exclusion: stringified worklet code depends on them.
- Deploy = push to `main` after passing checks, via GitHub Actions to Pages. Work on a branch, merge only when
  authorized, and verify the deployment/live result separately. Commit format: imperative summary + bullet body.
