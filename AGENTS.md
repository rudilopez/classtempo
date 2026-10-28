# AGENTS.md — working on ClassTempo

ClassTempo is the working name for a **phone- and iPad-first dance teaching player**, installed as a PWA.
One song or video plays at a time. The former DJ/mixing roadmap is retired. The repository and live URL are
now `classtempo`: https://rudilopez.github.io/classtempo/. Existing package names/storage keys retain `mixdeck`.

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
- `apps/web/src/classes` — live running order, actual-file preflight and paused session restoration.
- `apps/web/src/platform` — audio session recovery, keep-alive, Media Session and wake lock helpers/tests.
- `packages/engine` — shared AudioContext, `StretchDeck`, `VideoDeck`, `DancerPlayer`; legacy DJ code also remains.
- `packages/analysis` — pure audio BPM/beat-grid/waveform analysis, executed in a Worker.
- `packages/library`, `packages/midi`, legacy DJ components — scaffolds/legacy code, not current product UI.
- `docs/APPLE_MUSIC_FEASIBILITY.md` — separate integration gate; credentials and actual device tests are required.

## Rules

- Phone first: check 360×780, 390×844, 430×932 portrait; 844×390 landscape; and iPad 768×1024, 1180×820,
  1366×1024. No horizontal overflow. The main portrait player fits without page scrolling; library/practice
  dialogs scroll internally. Touch targets remain at least 44 px and full cue pads at least 72 px. Video Stage
  uses a compact horizontal row of 44 px numbered cue buttons, per the owner's requested layout. Respect safe areas.
  For Apple Music, also check Safari-sized usable viewports 360×640, 390×664 and 402×690/714/734. Verify
  panel containment and actual control overlap, not only document scroll dimensions. Keep seek inside Now Playing
  and Cues below the tempo tools; a full-screen desktop viewport is not equivalent to visible phone browser bars.
- One player only: Open accepts audio/video and detects the actual file type. Library Add saves the selection
  and opens its first file paused. Picker cancellation preserves the track. Class Auto-next is off by default;
  Next & play is an explicit advance/start action, and Again restarts the current exercise.
- Library has Media (all saved songs and videos) and Classes (ordered teaching plans). Search filters saved media, never music services. Failed saves may still
  open directly, with explicit unsaved feedback; Save current must preserve playback and practice settings.
- Production uses `Engine.create({ dj: false })`. Do not initialize hidden DJ decks/processors as a side effect.
- Cross-platform: feature-detect APIs and degrade honestly. Use generic wording such as lock-screen/headphone
  controls. Never claim physical iPhone playback, timer or lock-screen acceptance from desktop WebKit alone.
- iOS gesture rules: call `play()` / `engine.unlock()` / `keepAlive.start()` synchronously inside the gesture,
  before any `await`. A delayed first native-video start is not reliable; preserve the first-Play permission path.
- Preserve one native video element through Stage. Do not decode the full video's audio for analysis or waveform.
- Stage prioritizes picture size: keep playback/seeking visible, secondary cues/tools below the picture, and
  End practice reachable without opening a panel. The regular player keeps its full controls. Panel buttons must keep
  native keyboard activation without also firing global shortcuts; toggling trays never remounts the video.
- Cancel pending practice work before loads, manual seeks, pauses, cue launches and teardown. Delayed callbacks
  must not revive an old track. Practice sections are rehearsal controls, not sample-accurate loops.
- Keep cue keys `mixdeck.dancer.cues.<name>|<duration.toFixed(2)>` stable. Practice keys use
  `mixdeck.practice.<name>|<duration.toFixed(2)>`. The product rename must not erase existing saved work.
- Preserve independent per-exercise snapshots and repeated entries in class sets. Selecting a snapshot does not
  overwrite a file's default merely by loading it. Validate imported settings against actual track duration.
- Classes have separate preparation and live teaching views. Edit class uses an explicit Save; names, notes,
  order, snapshots and the default Auto-next setting survive backups. Add full media without inherited practice:
  a class entry without a snapshot starts at 100%, with no repeat or delay. Ordinary Media still restores its
  saved track settings. Add named practices from any saved media without requiring a player/library roundtrip.
- Before teaching, check the actual saved class files; an availability flag or metadata backup is not proof.
  Keep the running order and Next & play reachable in the player and below Stage's picture. Class completion
  follows the full-file end or final finite practice pass; endless practices never automatically advance.
  Pause, manual navigation, new media, errors and Exit class must cancel stale class transitions as well as
  practice timers. Missing/failed files stop advancement rather than being silently skipped. Restoring a class
  session loads paused and never resumes a countdown or starts playback without a new action.
- Save File/Blob and library metadata atomically. A successful load is not a successful offline save. Report
  failures; a metadata backup never proves the media exists. Browser storage may be evicted or cleared.
- Empty cue pads set the current position with one tap without changing playback. Saved cues preserve state
  in local files, Apple Music and Stage: jump and continue if playing; jump and remain paused if not playing.
  Only Play starts a paused track. Changing an existing cue requires Edit. Preserve Undo.
  Practice footer actions must commit the visible range directly; no separate Add-section prerequisite. A cue
  inside an active range keeps the practice settings and continues repeating only if already playing; leaving
  it must visibly explain the switch to full-track playback.
  Named practices retain independent playback snapshots. End practice cancels timers, pauses at the current
  position and disables the active delay/mode without deleting presets; returning to Play must not revive a pass.
  Dialogs contain focus, restore background inert state and prevent global player shortcuts while open.
- Apple Music is a music source in the familiar ClassTempo player, not a separate connection-test product.
  The owner approved the same-player experience at normal speed first, with clean streaming tempo research
  next. Reuse the shared branding, Now Playing, transport and Stage presentation. Browsing belongs in a picker
  that closes after selection; songs open paused. Source switches must stop the old source, cancel pending
  practice/class work, close its dialogs and prevent delayed callbacks from reviving it. Streaming playback
  stays inside MusicKit; never disguise a stream as a local File or feed protected samples into the local engine.
  Saved Apple Music cues must preserve playback state like local-file cues in the player and Stage. A paused
  cue must never start audio, including before the stream has initialized. A later Pause or source change must
  cancel pending cue work. Keep cue identity separate from filename-based local keys. Do not imply that
  matching controls establish streaming practice, class plans, stems, waveform/BPM analysis or offline support.
  Production Chrome authorization, read-only catalog/library access, paused selection, Play/Pause, seeking and
  teardown were verified on 2026-10-28 in the earlier connection screen. The owner confirmed clear audio at
  100%; playback beyond the preview range was observed. Slower playback warbled and faster playback changed
  pitch in that earlier experiment. After the slider and presets returned, the owner confirmed on 2026-10-28
  that all tempos sounded great on Mac. This is listening acceptance on the tested Mac, not proof for every
  browser or device. Playback info retains read-only diagnostics without a test-only label.
  The owner subsequently reported warbling on iPhone at 75%; requested, SDK and native rates all read 0.75,
  with readyState 4 and preservesPitch true. That iPhone listening check failed despite correct rate/flags.
  Other iPhone rates, iPad/Android listening and uninterrupted full-track completion remain unverified.
  Keep phone layout repairs separate from audio-quality claims; public MusicKit exposes no quality selector.
  Apple Developer membership was verified active on 2026-10-28. The ClassTempo MusicKit Media ID and key were
  created, and all three signing credentials were stored as GitHub Actions repository secrets.
  Keep signing keys in deployment secrets, public configuration network-only, and sign-in/Play gesture-driven.
  Never promise streaming tempo, phrase repetition, stems or offline parity without actual device evidence.
  The owner explicitly requires a web app across phones, not a native rewrite. Apple Music shows the shared
  50–150% slider, ±1% nudges and 50/75/90/100/110% presets without a special URL. The Playback info button
  opens read-only pitch/rate/timing diagnostics. Use only public MusicKit rate controls. Initialize and open
  new songs paused at 100%; Play/seek preserve the requested rate. Selecting 100% resets speed without
  changing playback state or a prepared cue offset. Browser timing and pitch flags do not prove clean sound.
  Keep Back 10s and Talk available. See docs/APPLE_MUSIC_TEMPO_TRIAL.md.
  Spotify is not integrated. See docs/APPLE_MUSIC_SETUP.md and docs/APPLE_MUSIC_FEASIBILITY.md.
- Stems uses opt-in local Spleeter separation for audio files only, with a 4:30/100 MB preparation limit.
  Ordinary song/video playback has no duration cap. The owner confirmed preparation of the supplied song and
  clear All-at-100% playback on the physical iPhone on 2026-10-23; Beta has been removed for this release.
  The pinned plain ORT bundle has a checked 256 MiB WASM cap; preserve its hash/version and build guards.
  WASM uses FP32 activations with unchanged verified FP16 stored weights; preserve the checked model adapter
  and per-stem finite-output validation. Never hide numeric failure by zeroing/clamping invalid estimates.
  Preserve the opt-in stem unity-playback adapter and test sample timing, queued transport changes and tempo
  transitions when changing it. Existing prepared stems must not need regeneration for playback-only fixes.
  Selecting the Stems pill never downloads models; Prepare explicitly downloads the pinned, hash-verified engine.
  Keep original playback available, preserve pending practice during Original/Stems switches, and cancel stale jobs on loads.
  Store complete aligned results atomically; never call a failed save offline-ready. Low/High drums are frequency
  filters, not independently separated instruments. No server upload/fallback is authorized. Preserve that
  device acceptance as the regression baseline; other media, tempos and device behaviors need their own evidence.
- Style: 2-space indent, single quotes, trailing commas, explicit exported API types, no `any`.
- Do not add dependencies without a reason documented in the commit. Do not commit `test-media/`, `.claude/`,
  credentials, user media or private backup files.
- Preserve Vite's ES2022 target and Signalsmith pre-bundling exclusion: stringified worklet code depends on them.
- Deploy = push to `main` after passing checks, via GitHub Actions to Pages. Work on a branch, merge only when
  authorized, and verify the deployment/live result separately. Commit format: imperative summary + bullet body.
