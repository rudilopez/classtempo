# Build plan

MixDeck is a phone- and tablet-first web app, installed to the Home Screen (PWA): iPhone and iPad (Safari)
and Android phones/tablets (Chrome) are the primary targets, desktop browsers are secondary. From Phase 0.5 on,
every phase is accepted on a real iPhone and iPad first (the Phase 0 slice was accepted on a laptop).

Estimates assume 2 engineers (one audio/DSP-leaning, one product/UI-leaning) plus part-time design, ≈ 34 weeks
total. Solo: roughly double. Phases are sequential by default; Phase 0.5 comes first because nothing else
matters if the app cannot be installed on an iPhone and keep playing with the screen locked. Phases 3 and 6 can
run in parallel with 2–5 once Phase 1 is stable.

## Phase 0 — Vertical slice (done in this scaffold)

- [x] Monorepo (npm workspaces): `apps/web`, `packages/engine`, `packages/analysis`, `packages/midi`, `packages/library`
- [x] AudioWorklet deck processor: transferred PCM, variable-rate playback, seek, loop, position reporting
- [x] Mixer graph: 3-band EQ, channel faders, equal-power crossfader, master
- [x] Tempo analysis in a Worker (onset envelope → comb scoring with tempo prior), beat phase, overview waveform
- [x] UI: two decks, drag-and-drop load, play/pause, cue, pitch ±8 %, 4-beat loop, tempo sync, waveform with beat markers
- [x] Unit test: synthetic click track → BPM within ±0.5
- [x] Dancer-default shell with mode pills; both modes remain loaded and pause when left
- [x] Dancer mode: one key-locked player (Signalsmith Stretch WASM AudioWorklet, tempo 50–150 %), 8 launchable cue
  pads (tap empty = set, tap set = jump & play, edit mode to re-set a pad, ✕ clear, ✎ rename), cues saved per track in
  localStorage, keyboard shortcuts, minimal UI with no EQ

**Acceptance:** two local tracks beat-matched with sync and mixed with EQ + crossfader, no audible dropouts on a laptop;
Dancer mode: cues set/launched and tempo 50–150 % key-locked without dropouts.

## Phase 0.5 — Phone & iPad foundation (weeks 1–2)

Status: built and unit-tested in code (`apps/web/src/platform/`, see ARCHITECTURE.md → *iOS / mobile audio* and
*Layouts*) and hosted at https://rudilopez.github.io/mixdeck/. The real-device checklist is still open, so the
acceptance below has not been run on devices yet.

Tasks
- [x] Installable PWA: web app manifest (standalone display, theme colours, relative `start_url`/`scope`), icons
  (192/512 px, maskable, 180 px `apple-touch-icon`), iOS meta (Home Screen title, status-bar style), offline
  service worker that precaches the app shell, worklets and WASM; request `navigator.storage.persist()`
- [x] HTTPS hosting on a static host — GitHub Pages at https://rudilopez.github.io/mixdeck/, deployed by
  `.github/workflows/deploy.yml` (typecheck → tests → build → deploy) on every push to `main`. The build stays host-agnostic (relative base `./`; the service worker also copes with clean-URL hosts
  that redirect `index.html` to `./`); preview deploys per branch (built into Vercel; on GitHub Pages use a
  separate preview host or a PR build artifact)
- [x] Audio session and background playback: `navigator.audioSession.type = 'playback'` (plays with the
  Ring/Silent switch on; skipped where the API is missing); song-length silent `<audio>` keep-alive started in the
  same tap as playback (Dancer mode); automatic resume on `visibilitychange` and when the context reports
  `'interrupted'`/`'suspended'`, with a full-screen "Tap to resume audio" overlay when the browser insists on a tap
- [ ] Tell the user in the UI to start playback before locking the screen (only the README says so today)
- [x] Lock-screen and headphone controls via the Media Session API (Dancer mode): title, play/pause, seek,
  previous/next = previous/next cue (previous restarts the current section, or goes to the cue before it within
  its first 2 s), no ±10 s skip buttons, scrubber kept in step with `setPositionState` at the current tempo —
  for the iOS / iPadOS lock screen and Control Center, the Android media notification and lock screen, Bluetooth
  headphone buttons and car stereos
- [ ] DJ mode keep-alive and lock-screen controls (play/pause → master deck)
- [x] Touch-first responsive layouts for iPhone portrait/landscape and iPad portrait/landscape (chosen by
  viewport, so Android phones/tablets and iPad Split View / Slide Over get them too): safe-area insets,
  `100dvh`, ≥ 44 px touch targets, no double-tap zoom, no pull-to-refresh; optional "Screen on" toggle in
  Dancer mode (Screen Wake Lock API, feature-detected)
- [x] File import from the Files app (or any system file picker): MP3, M4A/AAC, WAV, AIFF; FLAC and OGG where the
  browser decodes them
- [ ] Say in the import UI that Apple Music library songs cannot be imported (DRM; the browser cannot read the
  Music library)
- [ ] Real-device test matrix: iPhone + iPad on the current iOS/iPadOS, one Android phone (Chrome); a written
  checklist run before every release and on every iOS major/beta

Acceptance
- Installs from Safari (Share → Add to Home Screen) and, after one online launch from the Home Screen icon,
  launches offline (airplane mode)
- In Dancer mode, plays a 5-min song with the screen locked for 5 minutes on iPhone and iPad (iOS/iPadOS 17.5+)
  and an Android phone (Chrome) without stopping
- Lock-screen and headphone next/previous launch the next/previous cue (iPhone/iPad lock screen and Control
  Center, Android media notification, Bluetooth headphone buttons)
- No layout breakage at 375×667, 390×844, 430×932 (iPhone) and 744×1133, 768×1024, 820×1180, 834×1210,
  1024×1366 (iPad), in both portrait and landscape, and in an iPad Split View / Slide Over window (≈ 320–507 px wide)
- In Home Screen mode nothing sits under the status bar, notch / Dynamic Island or home indicator (iPhone and
  iPad, portrait and landscape)

## Dancer v2 — release and device acceptance

- [x] Dancer default and persistent Dancer / DJ mode pills.
- [x] Native video with pitch-preserving tempo, cue strip and Stage view using the same media element.
- [x] Labelled Screen on toggle, restored-cue message, current/next cue line on the lock screen.
- [x] Song-length keep-alive and seekable-session ordering fix; inactive playback guards and fullscreen recovery.
- [ ] Owner confirms lock-screen scrubbing on a real iPhone, Pause → Play, cue metadata, video/Stage and pills.

## Dancer stems — feasibility gate (new scope; no Stems FX)

First ship a hidden 30-second / 4-minute HTDemucs benchmark with on-demand model download, Worker inference,
WebGPU where supported and WASM fallback. Record actual provider, elapsed separation time, download size and
memory availability honestly; Safari may not expose peak process memory. Model and exact weight licensing must
be documented. The initial four-stem export is 166 MB. Upstream weights are research-restricted despite the exporter MIT tag;
clear production weight permission is a separate gate. See [STEMS_BENCHMARK.md](STEMS_BENCHMARK.md).

**Gate:** the owner's iPhone separates a four-minute song in approximately two minutes or less without crashing.
Decide with the owner after the measurements. A server fallback uploads songs and costs money and is **not
approved**. Until that decision, no full stems playback integration.

After acceptance (estimated 3–4 weeks): on-demand/offline model cache; chunked overlap-add with cancellation;
per-song OPFS cache and LRU management; four sample-locked stereo stems through one multichannel Signalsmith
node; Vocal, Instru (other), Bass, Drums, Kick, HiHat pads and Acapella / Instrumental / All shortcuts. Kick/HiHat
are filtered drum bands, not independently separated instruments. Audio files first; video and DJ stems later.
No Stems FX. Test reconstruction/crossovers, routing, cache eviction, timing across 50–150% tempo and offline use.

## Phase 1 — Core DJ engine (weeks 3–8)

Tasks
- Key lock: already shipped in Dancer mode via Signalsmith Stretch. Phase 1 brings key lock to DJ mode decks:
  Stretch in the deck path, toggle per deck, pitch range 6/8/16/50 %
- Phase sync (not just tempo), master deck selection, quantize (cue/loop/jump land on beats)
- Hot cues ×8 (set/jump/delete, colors, names), memory cues, loop in/out, auto loops 1/32–32 beats, loop roll, slip mode
- Beatgrid editor: tap/shift/stretch, downbeat marker, variable grid (`beats[]`) for drifting tempo
- Waveforms: overview + zoomed scrolling (Canvas 2D first, WebGL when 4 decks), color by frequency band
- FX rack: filter (LPF/HPF single knob), echo (beat-synced), reverb, flanger, phaser, gate, bitcrusher, roll; per-deck + master; beat-synced parameters
- Metering: channel/master VU, clip indication; master limiter
- Recording: worklet tap → WAV in Worker → MP3 (lamejs) option → download / share sheet
- Touch-first gestures: jog/nudge by dragging the waveform, pinch to zoom the waveform; keyboard shortcuts for desktop
- DJ layouts for portrait and landscape: phone landscape = full two-deck view, phone portrait = stacked decks with
  one-deck focus; iPad = two decks in any orientation
- 4-deck mode on iPad (landscape) and desktop; phones stay at 2 decks
- Engine test harness with `OfflineAudioContext`

Acceptance
- Key-locked ±8 % with no artifacts on a vocal track at normal listening level
- Loop boundaries sample-exact (test), sync phase error < 5 ms after 1 bar
- 60 fps UI with 2 zoomed waveforms on an iPhone 13-class phone, an A14-or-newer iPad and a 2020 MacBook Air; worklet CPU < 30 %

## Phase 2 — Library (weeks 9–12)

Tasks
- Import: file picker (Files app on iOS), drag-drop, File System Access folder handles where available (re-permission flow), cloud drive connectors (Google Drive, Dropbox, OneDrive) via OAuth
- Metadata via `music-metadata` (tags, artwork), duplicate detection by hash
- Analysis queue with concurrency limits, priority for "next track", versioned results, re-analyze; pauses while the app is backgrounded on phones
- Key detection (Essentia.js), Camelot notation, key-compatible filtering, energy/loudness; semitone key-shift
  suggestions (applied via Stretch on DJ decks)
- Crates, smart crates (query DSL), search (title/artist/bpm/key ranges), sort, history, "prepare" list
- Track prep view: set cues/loops without loading to a live deck
- Move Dancer cues from localStorage to IndexedDB (one-time migration, keyed by file hash); export/import cues as a file
- OPFS audio cache with LRU and size cap; offline library browsing

Acceptance
- 10k-track library: search < 50 ms, scroll at 60 fps on an iPhone 13-class phone and an A14-or-newer iPad (virtualized list), import 1k tracks < 2 min excluding analysis

## Phase 3 — Hardware & pro I/O (weeks 13–16) — lower priority (except iPhone/iPad headphone cueing)

Why lower priority: the primary devices are iPhone and iPad, and Safari on iPhone/iPad has no Web MIDI (and no
WebHID), so controller support in the browser is Android/desktop-only — a secondary audience for a phone-first
product. Only the MIDI side of Phase 5 pad modes and the Phase 7 mapping registry depend on it; if Phase 3
slips, those ship touch-only or later. Exception: split-output headphone cueing on iPhone/iPad is
primary-device work and is not deprioritised.

Tasks
- Web MIDI (Android Chrome, desktop Chromium; feature-detected and hidden on iOS): discovery, hot-plug, input/output (LED feedback), SysEx where needed
- Mapping JSON schema (control → action, modes, shift layers, soft-takeover, jog modes), MIDI Learn UI
- Preset mappings: Pioneer DDJ-FLX4, DDJ-200, DDJ-400/FLX6, Numark Mixtrack Pro FX, Reloop Buddy/Mixtour, Hercules Inpulse 200/300 (community-expandable registry)
- Jog wheel: scratch (platter-rate playback in worklet), pitch bend, search; latency tuning pass
- Headphone cueing on iPhone/iPad: investigate multi-channel USB-C/Lightning audio interfaces (does
  `ctx.destination.maxChannelCount` report > 2, can channels 3–4 carry the cue bus); otherwise split-output mode
  (mono master → L, mono cue → R, speakers + headphones via a Y-splitter cable)
- Cue output elsewhere: second `AudioContext` with `setSinkId` (Chromium); split-output mode everywhere; output device picker; multi-channel interface routing (channels 1–2 master, 3–4 cue)
- WebHID path for controllers that are HID-only (Chromium)

Acceptance
- iPhone/iPad: headphone cueing works in split-output mode with a Y-splitter; multi-channel interface results documented per device
- Android Chrome or desktop Chromium: FLX4 plug-and-play, all controls mapped, LEDs reflect state, scratch feels usable (< 20 ms round trip measured)
- Headphone cueing works on Chrome (device) and Safari (split)

## Phase 4 — Automix & transition intelligence (weeks 17–20)

Tasks
- Transition preset engine ("Crossfader Fusion" parity): crossfader position drives automation curves on filter, EQ, FX; presets (Cut, Dissolve, Echo Out, Riser, Filter Sweep); user-editable curves
- Automix: queue, next-track choice (bpm/key/energy), beat-aligned transition scheduling, length rules, pause/skip, Automix view with artwork
- Set planner (Claude API, server-side proxy): energy-curve planning over a crate, harmonic path, "mix out of this" suggestions with reasons; opt-in, never required

Acceptance
- Automix runs 1 hour over a varied crate with no clashes louder than –6 dB on the EQ'd spectrum (test harness), transitions land on bars; the hour runs on an iPhone 13-class phone and an A14-or-newer iPad with the screen locked (Phase 0.5 audio session), with no dropouts

## Phase 5 — Sampler, looper, pads (weeks 21–24)

Tasks
- Sampler engine (worklet): one-shot/hold/loop modes, quantized triggers, per-pad volume/pitch, 8×2 banks
- 48-slot grid looper: beat-matched, time-stretched loops, scenes
- Content packs: manifest + CDN delivery, licensing flags, in-app browser, user imports
- Pad modes: hot cues, loops, sampler, FX, beat jump; touch (+ MIDI once Phase 3 lands)

Acceptance
- Sampler/looper triggers land on the quantize grid within 1 ms (OfflineAudioContext test); 8 looper slots + 2 decks at 60 fps UI, worklet CPU < 40 % on an A14-or-newer iPad (2 decks + 4 slots on an iPhone 13-class phone)

## Phase 6 — Video & visuals (weeks 25–28)

Tasks
- Video decks: WebCodecs decode, frame-accurate sync to audio deck, crossfade/transition shaders
- Audio-reactive visualizer (WebGL/WebGPU), visual loops, title/image overlays
- External display: Presentation API / popup window with a visuals-only route on Chromium; on iPhone/iPad (no
  Presentation API) a full-screen visuals view shown via AirPlay/USB-C mirroring or a Stage Manager external display
- Live Photo/image slideshow decks

Acceptance
- Video deck stays within ±1 frame of its audio deck over a 10-minute track; external display route renders at 60 fps, including an iPad mirrored over AirPlay or USB-C

## Phase 7 — Product, platform & business (weeks 29–34)

Tasks
- Accounts (passkeys + OAuth), opt-in library/cue sync (CRDT-ish merge for cues/crates), mapping registry
  (publish/import; needs Phase 3)
- Plugin API: sandboxed FX / visualizer / analysis modules (iframes/Workers), published via the same registry as
  mappings; set and mapping share links
- Subscriptions (Stripe): free core (Phases 0–3 incl. Dancer mode, plus Automix from Phase 4); Pro = set planner, cloud sync, content packs, video, collaboration
- Collaboration: WebRTC session (shared state + optional audio relay), teacher/student mode
- Starter Mode / onboarding, accessibility (keyboard-only DJing, screen reader labels), localization
- Telemetry (opt-in), crash reporting, perf dashboards
- Native wrapper decision: only if App Store presence (or native MIDI on iOS) turns out to be needed

Acceptance
- Cold start < 2 s to first interaction on an iPhone 13-class phone; cue/crate edits made on two devices merge without data loss; Stripe checkout unlocks Pro features in the same session

## Cross-cutting

- CI: typecheck, unit, Playwright smoke (Chromium + WebKit, phone and tablet viewports), perf budget on every PR; preview deploys (per host, see Phase 0.5)
- Device/browser matrix maintained in README; every feature has a documented fallback; the Phase 0.5 real-device checklist runs before every release
- Security: COOP/COEP, CSP, sandboxed plugin iframes/Workers, no third-party scripts in the audio path
- Licensing audit: Signalsmith (MIT), Essentia (AGPL — isolate behind a Worker and ship source, or license commercially), content packs (per-pack)

## Risks & mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| iOS suspends Web Audio when locked/backgrounded | Music stops mid-rehearsal or mid-set | `navigator.audioSession.type = 'playback'` + silent looping keep-alive `<audio>` + Media Session; resume on `visibilitychange`/`'interrupted'`, "Tap to resume audio" when the browser wants a tap; real-device testing on each iOS release (and beta) |
| Safari evicts site storage after 7 days without use in a Safari tab, and any site (Home Screen apps included) under storage pressure | Saved Dancer cues and library metadata disappear | `navigator.storage.persist()`; export/import cues as a file; install to the Home Screen |
| Phone memory limits with long songs | Page reloads or crashes | One decoded 5-min song ≈ 115 MB at 48 kHz stereo float; strict "loaded + next" policy; decode-on-demand from the Phase 2 OPFS cache if memory limits are still hit |
| No Web MIDI / `setSinkId` on iPhone & iPad | No controllers or separate cue device on the primary devices | Product does not depend on them: touch-first UI, split-output cueing, Phase 3 controller work deprioritised; native wrapper only as a last resort |
| Time-stretch quality/CPU | Core mixing sounds bad or drops out | Signalsmith tuned per use (tempo vs scratch); quality tiers; WASM SIMD + threads |
| Scope creep (djay has 15 years of features) | Never ships | Phase gates with acceptance criteria; free tier = Phases 0–3 + Automix, Pro = everything that costs us server time or content licensing |

## Milestone summary

| Milestone | Target | Definition |
|---|---|---|
| M0 Slice | now | Two decks mix with sync; Dancer mode (this repo) |
| M0.5 Pocket | week 2 | Installable on iPhone/iPad, Dancer mode usable with screen locked |
| M1 Alpha | week 8 | Key lock in DJ mode, cues/loops, FX, recording, touch gestures — usable for a bedroom set on an iPad |
| M2 Library beta | week 12 | Real library, prep workflow, offline library |
| M3 Hardware | week 16 | Headphone cueing on iPhone/iPad (split output); FLX4-class controllers on Android/desktop (lower priority) |
| M4 Automix | week 20 | Hands-off mixing + set planner |
| M5 Public beta | week 24 | Sampler/looper, content packs |
| M6 Visuals | week 28 | Video decks, visualizer, external display |
| M7 1.0 | week 34 | Collaboration, accounts + opt-in sync, plugin API, Pro subscription live |
