# Vision & feature parity vs. djay

## What MixDeck is

A **phone- and tablet-first web app, installed to the Home Screen (PWA)**. The owner uses it on an iPhone and an
iPad; desktop browsers work but are not what the product is designed around. It is a static, fully client-side
site: songs never leave the device, cues leave it only with opt-in sync (Phase 7), and there is no account and
no server in the audio path.

The start screen offers two modes:

- **DJ mode** — two decks and a mixer (EQ, crossfader, sync, loops, cues): the djay-parity track described below.
- **Dancer mode** — a first-class product surface, not a cut-down DJ mode. One song, 8 launchable cue pads
  (tap an empty pad to set a cue at the playhead, tap a set pad to jump there and play, *Edit cues* to move a
  pad to the playhead, clear it (✕) or rename it (✎)), tempo 50–150 % with key lock (Signalsmith Stretch),
  cues saved per track on the device, minimal UI with no EQ or mixer, lock-screen and headphone controls
  (previous/next = previous/next cue) and an optional *Keep screen on*. It is built for rehearsal: marking
  choreography sections, jumping straight back to "the bridge" or "the second chorus", and slowing a song down
  to learn it without changing its key.

## Target devices

| Device | How it runs | Priority | Platform limits |
|---|---|---|---|
| iPhone | Safari (iOS 17.5 or later), installed to the Home Screen | Primary | No Web MIDI, no `setSinkId`, audio starts only on a tap |
| iPad | Safari (iPadOS 17.5 or later), installed to the Home Screen | Primary | Same as iPhone; DJ mode in any orientation |
| Android phones & tablets | Chrome, installed as an app | Primary | Web MIDI available (USB-OTG controllers) |
| Desktop (Chrome / Edge, Safari, Firefox) | Browser tab or installed app | Secondary — supported, not optimised | Full feature set on Chromium; Safari/Firefox degrade per feature |

**What iOS / iPadOS Safari lacks** (all browsers on iPhone and iPad use WebKit, so this applies to Chrome and
Firefox there too):

- **No Web MIDI** (and no WebHID): MIDI controllers cannot be used on iPhone or iPad in the browser.
- **No `setSinkId`**: no separate headphone-cue output device; headphone cueing will use split output (master L /
  cue R), Phase 3.
- **Audio must be started by a tap**: nothing can play until the user taps; after an interruption (call, Siri,
  another app) the audio may need another tap to resume.
- Web Audio is muted by the Ring/Silent switch and suspended when the screen locks unless the page declares a
  playback audio session and keeps a media element playing (see ARCHITECTURE.md → *iOS / mobile audio*).
- Songs in the Apple Music library cannot be imported (DRM, and the browser cannot read the Music library);
  files come from the Files app (iCloud Drive, On My iPhone, USB drives).

## What djay is (reference: djay for iOS / djay Pro 5, Algoriddim)

djay is the benchmark mobile DJ app. Its pillars:

| Pillar | What djay ships |
|---|---|
| Decks & mixer | 2/4 decks, classic turntable view, pro 2-deck waveform view, Automix view, Starter Mode |
| Neural Mix | Real-time AI stem separation (vocals / drums / bass / harmonics) with per-stem EQ, crossfade and pads; v2 built with AudioShake |
| Crossfader Fusion | Patented transition presets: crossfader morphs tracks by driving filters/FX/stems on automation curves |
| Fluid Beatgrid | Beat/tempo engine that follows tempo drift and breaks (live drummers, old records) |
| Automix | Hands-off mixing with AI transitions (Neural Mix, Dissolve, Riser, Echo) |
| Streaming | Apple Music, TIDAL (DJ Extension), SoundCloud, Beatport/Beatsource, plus local library |
| Sampler / Looper | Quantized sampler, 48-slot grid looper, 1,000+ loops/samples via content packs |
| Hardware | 50+ MIDI controllers plug-and-play, MIDI Learn, multi-channel USB audio, headphone pre-cueing (split output) |
| Video | Video decks, Live Photos, audio-reactive visuals, overlays, external display |
| Business model | Free core app + djay Pro subscription (~$7/mo or ~$50/yr at last public pricing) |

## What MixDeck must match (parity targets)

Everything in the table above except the two pillars listed under *Deliberately out of scope* below, with these mapped to web technology:

| djay feature | MixDeck implementation | Phase |
|---|---|---|
| — (no djay equivalent) | **Dancer mode**: one song, 8 launchable cue pads, tempo 50–150 % with key lock, cues saved per track on the device, minimal UI | 0 (shipped) |
| Background playback, lock-screen & headphone controls | `navigator.audioSession` playback + silent keep-alive `<audio>` + Media Session API (play/pause, seek, previous/next = previous/next cue, no ±10 s skips) for the iOS / iPadOS lock screen and Control Center, the Android media notification, Bluetooth headphone buttons and car stereos; "Tap to resume audio" after interruptions; optional Screen Wake Lock "Keep screen on" | 0.5 (Dancer mode in code; DJ mode to follow) |
| Starter Mode / pro layouts | Touch-first layouts for iPhone and iPad, portrait and landscape; Starter Mode onboarding | 0.5, 1, 7 |
| PWA / offline | Installable PWA (manifest, icons, offline service worker) in 0.5; OPFS offline library in 2 | 0.5, 2 |
| 2–4 decks, mixer, EQ, filter, faders | AudioWorklet deck processors + Web Audio graph; 2 decks (0), 4 decks on iPad landscape and desktop (1) | 0–1 |
| Key-locked tempo (master tempo) | Signalsmith Stretch (MIT, C++→WASM AudioWorklet): shipped in Dancer mode; DJ decks get a key-lock toggle | 0 (Dancer), 1 (DJ) |
| Beatgrid, sync, quantize | Analysis Worker (onset → tempo → variable beatgrid à la Fluid Beatgrid) | 0–1 |
| Hot cues, loops, loop roll, slip | Worklet state machine, sample-accurate | 1 |
| FX (echo, reverb, flanger, phaser, filter, bitcrush, gate…) | AudioWorklet FX chain, per deck + master | 1 |
| Recording | Worklet tap → WAV/MP3 (lamejs) encoder in Worker → download/share sheet | 1 |
| Library, crates, smart playlists, history | IndexedDB (idb) + OPFS audio cache; Files-app import on iOS, File System Access folders where available | 2 |
| Key detection + Camelot wheel | Essentia.js (WASM) key extractor | 2 |
| Controllers (DDJ-FLX4, DDJ-200, Mixtrack, Reloop Buddy, …) | Web MIDI + mapping JSON + MIDI Learn; WebHID for HID-only decks — Android Chrome and desktop Chromium only (no Web MIDI on iPhone/iPad) | 3 |
| Headphone cue / split output | Split output (mono master L / cue R, Y-splitter) everywhere incl. iPhone/iPad; `setSinkId` second context on Chromium; multi-channel USB interfaces on iOS under investigation | 3 |
| Crossfader Fusion | Transition preset engine: crossfader position → automation curves on filter/FX gains | 4 |
| Automix | Automix engine using beatgrids + energy profile + transition presets | 4 |
| Sampler / 48-slot looper | Quantized sample players (worklet), content packs from CDN | 5 |
| Video / visuals | WebCodecs + WebGL/WebGPU compositor; external screen via Presentation API / popup on Chromium, AirPlay/USB-C mirroring or a Stage Manager external display on iPhone/iPad | 6 |

## Where MixDeck beats djay

1. **Dancer mode — built for rehearsal.** djay has no rehearsal-oriented mode: it is a mixing tool. Dancers and
   choreographers get one song, eight big pads for the sections they rehearse, and a 50–150 % key-locked tempo
   to learn a routine slowly without the song changing key — with lock-screen and headphone controls for
   play/pause and previous/next cue.
2. **One link, no store.** Open it in Safari, add it to the Home Screen, done; the same app runs on iPhone,
   iPad, Android and desktop browsers. djay ships a separate native app per store and platform.
3. **Private by construction.** Songs never leave the device; cues and crates leave it only if you opt in to
   Pro cloud sync (Phase 7), and the opt-in set planner (Phase 4) sends track metadata, never audio. No account
   is needed for anything in the free tier.
4. **Shareable everything.** Sets, cue points, loops, transition presets and controller mappings are URLs or
   small files. Open mapping registry instead of a closed list of "supported" controllers.
5. **Collaborative sessions.** Two DJs, two devices, one mix (WebRTC): back-to-back sets remotely, or a
   student/teacher mode where the teacher sees the student's decks.
6. **Set intelligence.** An LLM-assisted set planner (Claude API): energy-curve planning, harmonic
   compatibility, "what mixes out of this" suggestions, crowd-tempo pacing — explained, not black-box. (djay has
   nothing comparable.)
7. **Harmonic mixing built in.** Key detection, Camelot wheel, key-compatible filtering and semitone key-shift
   suggestions so tracks blend cleanly.
8. **Prep on the phone, play on the iPad.** Analysis, cueing and crate building work on the phone; with sync
   (Phase 7) the iPad picks up the same cues and crates.
9. **Open plugin surface.** FX, visualizers and analysis modules as sandboxed JS/WASM modules; a community can
   extend the app (plugin API, Phase 7).
10. **Honest free tier.** Dancer mode and core two-deck mixing with local files are free forever; subscription
    funds the set planner, cloud sync, content packs, video and collaboration.

## Hard constraints (be honest about these early)

- **iOS audio rules.** Audio starts only from a tap; Web Audio is muted by the silent switch and suspended in
  the background unless the page uses a `'playback'` audio session plus a keep-alive media element; calls and
  Siri interrupt the context. No `setSinkId` (split-output cueing), no Web MIDI, no WebHID on iPhone/iPad.
  Feature-detect everything, degrade gracefully, surface the limitation in the UI.
- **Storage on iOS.** Safari can evict script-written storage (localStorage, IndexedDB, OPFS) after 7 days
  without use in a Safari tab, and any site under storage pressure; Home Screen apps keep their own storage but
  are not immune. Ask for persistent storage and let users export/import their cues as a file.
- **Memory on phones.** A decoded 5-min stereo song at 48 kHz float32 is ≈ 115 MB; keep only "loaded + next"
  in RAM.
- **Other browsers.** Firefox has no `setSinkId` on `AudioContext` (split-output mode); `SharedArrayBuffer`
  needs COOP/COEP headers, which some static hosts cannot set.
- **Latency.** AudioWorklet at 128 frames + output latency gives ~10–25 ms on desktop Chrome, more on phones
  and much more over Bluetooth headphones and speakers. Bluetooth is fine for Dancer mode but not for
  beat-matching by ear; wired output is fine for mixing and marginal for scratching; jog-wheel scratch gets its
  own tuning pass.

## Deliberately out of scope

- **Stem separation.** Product decision: MixDeck does not ship stem separation, and it also happens to be one of the weakest bets on the web platform (80–170 MB models with unproven mobile performance).
- **Streaming-service integration.** Product decision: MixDeck does not integrate music streaming services, and it also happens to be one of the weakest bets on the web platform (DRM streams never expose PCM, so nothing can be analysed, EQ'd or mixed); the user's own files on cloud drives (Google Drive, Dropbox, OneDrive) stay in scope.

## Non-goals (v1)

Native app wrappers (the installable PWA is the app; revisit only if App Store presence is needed), Ableton
Link, DVS/timecode vinyl, 4-deck video, Windows/macOS store listings.

## References

- Algoriddim djay (iOS) product page — https://www.algoriddim.com/djay-ios
- djay Pro 5 announcement (Crossfader Fusion, Fluid Beatgrid) — https://www.digitaldjtips.com/djay-pro-5-brings-better-stems-beatgridding/
- Signalsmith Stretch (MIT pitch/time library) — https://github.com/Signalsmith-Audio/signalsmith-stretch
- Essentia.js (BPM/key/onsets in WASM) — https://mtg.github.io/essentia.js/
- Audio Session API (W3C draft, shipped in Safari) — https://w3c.github.io/audio-session/
- Media Session API (MDN) — https://developer.mozilla.org/en-US/docs/Web/API/Media_Session_API
