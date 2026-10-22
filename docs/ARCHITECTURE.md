# Architecture

MixDeck is a phone- and tablet-first web app, installed to the Home Screen (PWA). It is a static, fully
client-side site: songs never leave the device, and cues leave it only with opt-in sync (Phase 7). Design
decisions are judged on an iPhone and an iPad first, desktop browsers second.

## Stack

| Layer | Choice | Why |
|---|---|---|
| Language | TypeScript (strict) everywhere; C++/Rust → WASM for DSP hot paths | one toolchain; WASM where JS is too slow |
| UI | React 19 + Vite, Zustand for app state, CSS variables (no UI framework) | fast iteration; DJ UIs are custom anyway |
| Audio | Web Audio API + **AudioWorklet** (all playback/DSP), WASM modules loaded inside worklets | sample-accurate, off-main-thread |
| Time-stretch | Signalsmith Stretch (MIT) compiled to WASM (`signalsmith-stretch` AudioWorklet); live in Dancer mode, DJ decks in Phase 1 | best open-source quality/CPU trade-off |
| Analysis | Workers: own onset/tempo code (Phase 0) → Essentia.js for key, onsets, loudness | cheap, proven |
| Controllers | Web MIDI API, WebHID for HID decks, mapping JSON — Android Chrome and desktop Chromium only (iPhone/iPad Safari has neither) | plug-and-play like djay where the platform allows |
| Storage | localStorage for Dancer cues today → IndexedDB (idb) for metadata and cues (Phase 2), OPFS for audio cache, File System Access API for folders where available (Files-app picker on iOS) | offline-capable library |
| Video | Dancer: native `<video playsinline>` via `VideoDeck`, pitch-preserving playback and Stage view. Future DJ visuals: WebCodecs + WebGL/WebGPU compositor | Native media avoids decoding entire phone videos into RAM |
| Collab | WebRTC data channels (state sync) + optional audio relay | low-latency B2B |
| Backend | None for the core app. Phase 4: thin proxy for the set planner (Cloudflare Workers); Phase 7: accounts, sync, Stripe on Workers + D1/R2 or Node (Hono) + Postgres/S3 | small ops surface, grows only when paid features need it |
| Hosting | GitHub Pages at `https://rudilopez.github.io/mixdeck/`; push to `main` runs checks and deploys | HTTPS is required for AudioWorklet, service workers and install |
| Packaging | Installable PWA first (manifest + custom service worker emitted by a Vite plugin, relative base so any static host works); native wrappers only if App Store presence is needed | installable, offline, no store review |
| Tests | Vitest (DSP unit + golden files), Playwright (e2e on Chromium + WebKit with phone/tablet viewports, `--autoplay-policy=no-user-gesture-required`), perf budgets in CI, real-device checklist | DSP regressions are silent otherwise; iOS behaviour only shows on devices |

## Audio graph (per deck → mixer → master)

```
[DeckProcessor (AudioWorklet)] ──► [FX chain (worklets)] ──► [EQ: low shelf → peaking → high shelf] ──► [Filter] ──► [Channel fader]
        │ sample playback, time-stretch, loops, cues, slip                                                         │
        │                                                                                                          ▼
        │                                                              [Crossfader gain (equal-power)] ──► [Master: gain → limiter] ──► destination
        │                                                                                                          │
        └──► [Cue bus send] ─────────────────────────────────────────────────────────────────────────────────────► [Cue output: 2nd AudioContext via setSinkId, or L/R split]
                                                                                                                   └──► [Recorder tap (worklet) → encoder Worker]

[StretchDeck (Signalsmith Stretch AudioWorklet)] ──────────────────────────────────────────────────────────────► [Dancer gain 0.9] → destination
```

- One `AudioContext` (`latencyHint: 'interactive'`); cue output is a second context bound to another device with `setSinkId` where supported, else a split-output mode (master → L, cue → R) on the same context. iPhone/iPad never have `setSinkId`, so split output (or a multi-channel interface, Phase 3 investigation) is the iOS path.
- Every DJ deck is one `AudioWorkletNode` that owns the track's PCM (transferred `Float32Array`s), its playhead and loop/cue state.
- Dancer mode uses a `StretchDeck`: Signalsmith Stretch's WASM worklet driven by a schedule-based time map (output time → input position, rate), so tempo never changes pitch and a launched cue is heard from its exact position. The engine API is `Engine.getStretchDeck(): Promise<StretchDeck>` — deliberately *get*, not *create*: the Signalsmith processor can never be torn down (it keeps rendering after `disconnect()` for the life of the context), so there is exactly one `StretchDeck` per engine, created on first use and connected to a dedicated Dancer output gain (0.9), independent of DJ master; a consumer calls `StretchDeck.release()` (silent, empty, callbacks cleared, tempo and pitch reset) when it is done instead of discarding it, and the next consumer gets the same instance.
- DJ decks in Phase 0 use linear-interpolated variable-rate playback (pitch changes with tempo). Phase 1 brings Signalsmith Stretch into the deck path with a key-lock toggle.

## Dancer video and Stage

`DancerPlayer` is the shared transport contract for `StretchDeck` and `VideoDeck`. `VideoDeck` owns a native
video element and Blob URL, uses `preservesPitch`, and reports native play/pause/end/position events. Videos
stay outside the Web Audio graph. The video element mounts while metadata loads, and remains mounted when
its dimensions arrive late. No `decodeAudioData` or whole-file audio analysis runs for videos: they use a
seekable timeline and percent tempo. `VideoView` distinguishes metadata from first-frame readiness and displays
loading, buffering or decoder errors. Failed and stale play promises cannot leave the transport stuck on Pause;
Play at the end restarts. `VideoView` reparents that same element between the waveform card and Stage,
so closing Stage preserves position, tempo and media identity. Stage requests element fullscreen where available
and falls back to a viewport overlay; it offers only play/pause, restart and existing cue launches. Arrow-key
tempo changes and file drops are disabled there. Focus stays within Stage and its background app is inert. Cues retain the stable localStorage key
`mixdeck.dancer.cues.<name>|<duration.toFixed(2)>`; loading saved cues displays a restoration message.

## Threading model

```
Main thread (React)        Engine façade (main, no DSP)         AudioWorklet thread            Workers
──────────────────         ────────────────────────────         ────────────────────           ────────────────────────────
UI events  ──────────────► Deck/Mixer API (TS classes) ───────► DeckProcessor (per deck)       Analysis (BPM/key/waveform)
rAF render ◄────────────── position/meters (SharedArrayBuffer    FX processors
                           ring or throttled port messages)      Recorder tap                   Encoder (WAV/MP3)
                                                                 Stretch (Dancer)               Library indexer / metadata
```

- The engine façade (`packages/engine`) is the only thing the UI talks to. It is framework-agnostic so it can be tested in Node (with a fake context) and reused by a headless Automix/CLI.
- Sample-accurate scheduling lives in the worklet: "play at next beat", loop boundaries, cue jumps and sync phase corrections are resolved there, not on the main thread.
- Analysis is off-thread and cancellable (track replaced before analysis finishes).

## Timing & sync

- **Beatgrid model:** `{ bpm, firstBeat }` for constant-tempo tracks plus an optional `beats: Float64Array` of absolute beat times for drifting tempo (Fluid Beatgrid parity). All quantize/sync/loop math goes through one `Beatgrid` class so both representations behave identically.
- **Sync:** tempo lock (rate = masterBpm / deckBpm) + phase lock (nudge rate briefly to align beat phase, then release). Master deck is explicit (djay-style) with "auto master" fallback.
- **Clock:** `AudioContext.currentTime` is the only clock. The worklet reports positions with the context time they are valid for; the UI extrapolates between reports for smooth waveforms.

## iOS / mobile audio

Everything here is feature-detected and degrades silently: Android Chrome and desktop browsers skip what they do
not have (no `navigator.audioSession`, no Screen Wake Lock, an unsupported Media Session action), and nothing
depends on one brand of phone or headphones. The browser-facing helpers live in `apps/web/src/platform/` (each
with a Vitest test); the audio session is set by the engine.

- **User-gesture start.** The shell creates a suspended `AudioContext` on launch; `Engine.create()` does not
  await its resume. `Engine.unlock()` resumes synchronously during the first gesture and playback handlers.
  Dancer is the default. Both modes remain mounted; leaving one pauses it and stops its waveform rendering.
- **Audio session** (`packages/engine/src/engine.ts`). `Engine.create()` sets
  `navigator.audioSession.type = 'playback'` before it creates the context (Safari 16.4+), so MixDeck plays with
  the Ring/Silent switch on and is treated as media playback rather than ambient sound. Browsers without
  `navigator.audioSession` skip it; a failure never blocks audio.
- **Keep-alive** (`platform/keepAlive.ts`). A hidden, unmuted `<audio playsinline>` plays a generated silent
  8 kHz WAV matching the song length (rounded up plus one second; minimum 10 s, capped at 20 minutes). Ordinary
  songs do not loop: looping had overwritten the lock-screen timeline with the short silent file's position.
  Longer songs use a capped looping fallback. Position and tempo follow the active audio player. Set Media
  Session to playing before starting the element; on WebKit, `claim()` reclaims the seekable media session after
  the AudioContext starts. See the source comment for the WebKit investigation. Native videos use their own
  media element and never start the silent keep-alive. Leaving Dancer stops it; externally initiated playback
  while Dancer is inactive is rejected. **Lock-screen scrubbing needs confirmation on a real iPhone**, including
  Pause → Play; paused scrubbing remains a documented WebKit limitation.
- **Media Session mapping** (`platform/mediaSession.ts`, `platform/cueNavigation.ts`): the lock-screen and
  headphone controls — the iOS / iPadOS lock screen and Control Center, the Android media notification and lock
  screen, Bluetooth and wired headphone buttons, car stereos, desktop media keys. Dancer mode registers them
  while a song is loaded:
  - `metadata`: title = file name, artist line = current/next cue section (for example "Chorus · next: Bridge"), artwork = the app icons (relative paths).
  - `play` / `pause` → transport; `stop` → pause and back to 0:00.
  - `previoustrack` / `nexttrack` → previous / next cue relative to the playhead, launched and playing (on many
    headphones a double press is next and a triple press is previous). Previous follows the music-player
    2-second rule: more than 2 s past the latest cue at or before the playhead → back to that cue; within its
    first 2 s → the cue before it; no earlier cue → the start of the song. Next is the earliest cue more than
    50 ms after the playhead (so a cue just launched is not "next"); with none it does nothing. Empty pads are
    skipped, and pad order does not matter.
  - `seekto` → seek (the play state is unchanged).
  - No ±skip handlers: `seekbackward` / `seekforward` are always cleared, so lock screens show previous / next
    buttons instead of ±10 s skips and headphone presses reach previous / next.
  - `playbackState` and `setPositionState({ duration, position, playbackRate: tempo })` after every play, pause,
    seek, cue launch, tempo change, load and track end, and every 5 s while playing, so the lock-screen scrubber
    advances at the current tempo.
  - Handlers, metadata, position and playback state are cleared when the song is unloaded or Dancer mode is left.
  - DJ mode has no keep-alive or Media Session yet (planned: play/pause → master deck).
- **Screen on** (`platform/wakeLock.ts`). An optional toggle in the Dancer mode header, shown only where the
  Screen Wake Lock API exists. It reads on only while the browser actually holds the lock (a refused request,
  e.g. in Low Power Mode or battery saver, switches it back off), the lock is requested again each time the page
  becomes visible (browsers drop it whenever the page is hidden), and it is released when Dancer mode is left.
- **Interruption recovery** (`platform/audioRecovery.ts`, wired in `App.tsx` for both modes). Calls, voice
  assistants (Siri), alarms or another app taking audio move the context to `'interrupted'` (WebKit) or
  `'suspended'`. On every context `statechange`, and whenever the page becomes visible again, a context that
  should be running (a DJ deck or the Dancer deck is playing) is resumed with `ctx.resume()` and the Dancer
  keep-alive is restarted. If it is still not running 500 ms later the browser wants a tap: a full-screen
  **Tap to resume audio** overlay ("Playback was interrupted") appears, its tap resumes the context and the
  keep-alive inside the gesture, and it disappears once the context runs. The overlay is portalled into the
  current fullscreen element (or body), so Stage cannot hide it behind the fullscreen top layer. Decks are not paused: a stopped
  context's clock does not advance, so playback continues where it stopped. Dancer mode's play and cue launch
  also resume a context left suspended by an interruption that ended while paused.
- **Persistent storage** (`platform/persist.ts`, `pwa/registerSW.ts`). `navigator.storage.persist()` is
  requested after load by the service-worker registration (production builds) and by Dancer mode the first time
  a cue is set in a page load; an origin that is already persisted is not asked again (Firefox shows a prompt;
  Chromium and Safari decide silently, and installed apps usually qualify). Safari can still evict site storage
  (7-day rule for Safari-tab use, storage pressure for everything), so cues also become exportable as a file
  (Phase 2).
- **No `setSinkId`** on iPhone/iPad. One output device only; headphone cueing is split output (master L / cue R)
  or a multi-channel interface (Phase 3).
- **No Web MIDI / WebHID** on iPhone/iPad. Controller UI (Phase 3) will be hidden there.
- **Bluetooth.** Bluetooth headphones and speakers add large output latency: fine for Dancer mode, not for
  beat-matching by ear in DJ mode.

### Layouts

Layouts switch on viewport size and input type, never on device type: an iPad in Split View / Slide Over or a
narrow Stage Manager window gets the phone layout, and Android phones and tablets get the same layouts as iPhone
and iPad. Breakpoints, as in `apps/web/src/styles.css`:

| Viewport | Media query | Dancer mode | DJ mode |
|---|---|---|---|
| Phone portrait / narrow window | `(max-width: 599px)` | One column fitted to the screen: clock + BPM, song title inside the media panel, transport, tempo, compact 4×2 pads; media takes spare height | Stacked (deck A, mixer, deck B), the page scrolls; "Rotate your phone for the full mixer" in portrait |
| Phone landscape | `(orientation: landscape) and (max-height: 499px)` | Two columns, compact: song, clock, waveform, transport and tempo on the left, pads filling the right | Deck │ mixer │ deck with no page scroll (from 600 px wide), compact mixer |
| Tablet / desktop portrait | everything else | One column in a card (≤ 1100 px wide) with a larger clock, waveform and pads | Deck │ mixer │ deck |
| Tablet / desktop landscape | `(orientation: landscape) and (min-width: 560px)` | Two columns with a wider pad column; from 500 px tall the card stops at 760 px high, centred | Deck │ mixer │ deck |

- **Dancer mode details:** in portrait the clock, waveform and play button scale with `clamp(…dvh…)`; phones
  ≤ 700 px tall tighten the spacing and edit mode drops the pad times; landscape windows ≤ 380 px tall are extra
  compact and phone landscape hides the keyboard-shortcut line; narrow pads put ✕ / ✎ side by side along the
  bottom edge. The "Screen on" toggle is labelled at every size. When editing video cues on a phone, the
  tempo controls hide to keep the pad editor within the viewport; at ≤379px this also applies to audio cue editing.
- **DJ mode details:** it also stacks in any window ≤ 699 px wide and ≥ 500 px tall; below 1024 px wide (and in
  phone landscape) the decks narrow and the mixer goes compact, with the master fader as a row under the EQ.
  One-deck focus on phone portrait, touch gestures and 4 decks on iPad landscape come in Phase 1.
- **Shell:** header mode pills form an accessible radio group; Dancer is always the launch default. The header
  shares one row with Dancer Load / Screen on actions, portalled from Dancer to preserve handler ownership.
  The sample-rate / latency readout remains in DJ at wider sizes. Inactive modes retain loaded tracks and settings.
- **Visual hierarchy:** ink background, elevated media/tempo surfaces, mint Play, cyan waveform and colored cue
  outlines. Now Playing replaces its O with the supplied white logo while retaining a complete accessible label.
  The tempo percentage is centered on the slider line; Stage cue rows are 72 px in portrait. The Screen on
  confirmation explains dimming/auto-lock prevention while visible.
- **Touch:** Dancer mode buttons, the pad ✕ / ✎ tools and the mode pills are ≥ 44 px everywhere, and every
  button is on touch screens (`pointer: coarse`); hover styles apply only under `hover: hover`; keyboard
  shortcut hints are hidden on touch-only devices (`hover: none` and `pointer: coarse`).
- **All layouts:** `#root` is `100dvh` (`100vh` fallback) and padded with `env(safe-area-inset-*)`, and
  `index.html` sets `viewport-fit=cover` (edge to edge; the padding keeps content clear of the notch / Dynamic
  Island, display cutouts, rounded corners and home indicator) with the `black` Home Screen status-bar style;
  `touch-action: manipulation` on buttons, inputs, labels and canvases (no double-tap zoom, pinch-zoom still
  works); `overscroll-behavior: none` on `html` / `body` (no pull-to-refresh or rubber-band bounce). The
  "Tap to resume audio" overlay pads with the same insets.

## Experimental stems benchmark

The static hash route `#stems-benchmark` lazy-loads a local-only feasibility page. Its model is pinned by revision
and SHA-256. The user explicitly starts the download; the normal app and its service-worker precache exclude
stems bundles and the 28.3 MB ORT WASM runtime. Requested lab assets then use the normal cache-first path; the
166 MB model uses a separate cache. The song is decoded locally to 44.1 kHz stereo and transferred to a Worker.
Single-thread ONNX Runtime works without cross-origin-isolation headers on GitHub Pages. Fixed 7.8-second
chunks with 25% overlap feed bounded overlap-add; only five-second stem previews survive the benchmark.

Reports distinguish elapsed separation, initialization, model read/download and end-to-end time. WebGPU session
creation alone is not proof of GPU execution; the report counts observed queue submissions and records fallback
reasons. Reliable total peak memory is unavailable in Safari; any JS heap sample is explicitly incomplete.
Cancelling terminates the Worker. See [STEMS_BENCHMARK.md](STEMS_BENCHMARK.md) for model provenance and acceptance.

## Data model

Types live in `packages/library/src/index.ts` (`History` is `HistoryEntry` there); the controller `Mapping` is
`ControllerMapping` in `packages/midi/src/index.ts`, and `DancerCues` is described below.

```ts
Track      { id, title, artist, album, duration, sampleRate, source: SourceRef, fileHash, addedAt }
Analysis   { trackId, bpm, firstBeat, beats?, key, loudness, waveform: { overview, zoomTiers[] }, version }
CuePoints  { trackId, hotCues[8], loops[8], memoryCues[] }
DancerCues { trackKey, cues[8] }   // trackKey = file name + duration; cues[i] = { time, name } | null
Crate      { id, name, trackIds[] | smartQuery }
History    { sessionId, playedAt, trackId, deck }
Mapping    { controllerId, vendor, product, version, bindings[] }
SourceRef  { kind: 'file' | 'fsa-handle' | 'drive', provider?: 'google' | 'dropbox' | 'onedrive', ... }
```

- `DancerCues` live in localStorage today (`mixdeck.dancer.cues.<name>|<duration>`, see `apps/web/src/dancer/cueStore.ts`) and move to IndexedDB in Phase 2 (one-time migration, then keyed by `fileHash`), with export/import as a file.
- Everything else is stored in IndexedDB; audio itself is never copied into IndexedDB — it lives in OPFS (cache) or is re-read from the user's folder handle / re-picked from the Files app.
- Analysis is versioned so an improved algorithm can re-analyze lazily.

## Module map

| Package | Responsibility | Depends on |
|---|---|---|
| `@mixdeck/engine` | AudioContext ownership, decks, Dancer `StretchDeck`, mixer, FX, recording, cue output | — |
| `@mixdeck/analysis` | Pure functions: tempo, beatgrid, key, waveform tiers, loudness | — (WASM optional) |
| `@mixdeck/midi` | Web MIDI/HID discovery, mapping schema, MIDI Learn, preset mappings (Android/desktop only) | engine |
| `@mixdeck/library` | Track store, import pipeline, crates, search, history, sync | analysis |
| `@mixdeck/automix` (Phase 4) | Transition presets, automix scheduler, set planner client | engine, library |
| `@mixdeck/ui` (later) | Shared components: waveform, knobs, pads, meters | — |
| `apps/web` | The app shell, mode pills, DJ and Dancer modes, native video and Stage, layouts, state, PWA (manifest + service worker), platform helpers (`src/platform/`: keep-alive, Media Session, wake lock, interruption recovery, persistent storage) | all of the above |

## Performance & platform notes

- **Budgets:** worklet work < 50 % of the render quantum (128 frames ≈ 2.7 ms at 48 kHz) with 2 decks + FX on an iPhone 13-class phone, 4 decks + FX on an A14-or-newer iPad and a 2020 MacBook Air; UI at 60 fps while 2 waveforms scroll on the same devices; analysis of a 5-min track < 3 s on a laptop and < 6 s on an iPhone 13-class phone; first interaction < 2 s on a cold load on that phone (engine chunk split from library chunks; installed app served from the service-worker cache).
- **Memory:** a 5-min stereo track at 48 kHz float32 is ~115 MB. Keep at most "loaded + next" tracks in RAM; phones (and older iPads) are the binding limit.
- **Headers:** `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp` make `SharedArrayBuffer` (worklet↔UI ring buffers, multithreaded WASM) available. Nothing shipped needs it yet (port messages are the fallback). Vercel can set the headers in its config; GitHub Pages cannot set headers, so there the service worker would have to add them to its responses.
- **Base path:** the build uses a relative base (`./`), and the manifest `start_url`/`scope` and service-worker scope are relative too, so the same `dist/` works at a host root or under a sub-path.
- **Mobile Safari:** see *iOS / mobile audio* above.

## Testing strategy

- DSP: Vitest unit tests on pure functions with synthetic signals (click tracks, chirps) and golden-file checks on real tracks (hashes of analysis output).
- Engine: run `OfflineAudioContext` renders in Chromium via Playwright; assert RMS/phase relationships (e.g., crossfader equal-power sum, loop boundaries sample-exact).
- UI: Playwright e2e on Chromium and WebKit with iPhone/iPad device profiles and fake audio and MIDI (Web MIDI mock), visual regression on waveform/pads at the Phase 0.5 viewport sizes.
- Real devices: lock-screen playback, lock-screen and headphone controls, interruptions and Home Screen install cannot be automated; the Phase 0.5 checklist runs on an iPhone, an iPad and an Android phone before every release and on each iOS major/beta.
- Perf: CI job renders a 4-deck session offline and fails on budget regressions.
