# MixDeck — a phone- and tablet-first DJ app for the web

Working title. A **phone- and tablet-first web app, installed to the Home Screen (PWA)**: iPhone, iPad and
Android phones/tablets are the primary targets; desktop browsers are supported but not optimised. It is a
static, fully client-side site — songs and cues never leave the device (any future cloud sync is opt-in).

Goal: match djay (iOS / djay Pro 5) feature-for-feature where the web platform allows it — minus stem
separation and streaming-service integration, which are deliberately out of scope — and beat it where the web
gives us an edge: one link instead of an App Store install, a rehearsal-oriented Dancer mode djay does not have,
shareable sets and mappings, real-time collaboration, and an open plugin surface.

**Status:** Phase 0 vertical slice done; Phase 0.5 (phone & iPad foundation: installable PWA, lock-screen and
headphone controls, touch layouts) is built in code, with HTTPS hosting and real-device testing still to do. The
start screen offers two modes:

- **DJ mode** — two decks, 3-band EQ, crossfader, master, pitch ±8 % (changes key until DJ key lock lands in
  Phase 1), 4-beat loop, cue, tempo sync, BPM + beatgrid analysis, overview waveform — all on Web Audio +
  AudioWorklet.
- **Dancer mode** — one song and 8 launchable cue pads: tap an empty pad to set a cue at the playhead, tap a set
  pad to jump there and play, *Edit cues* to move a pad to the playhead, clear it (✕) or rename it (✎). Tempo
  50–150 % with key lock (Signalsmith Stretch), cues saved per track on the device, minimal UI with no EQ.
  Lock-screen and headphone controls (iPhone/iPad lock screen and Control Center, Android media notification,
  Bluetooth headphone buttons, car stereos): play/pause, seek, and previous/next = previous/next cue; playback is
  meant to continue with the screen locked if it was started first. Optional *Keep screen on* (where the browser
  supports Screen Wake Lock) keeps the screen from dimming and locking mid-routine. Built for rehearsal:
  choreography sections on pads, and slowing a song down to learn it without changing its key.

## Quick start

```bash
npm install
npm run dev
```

Open http://localhost:5173, tap **DJ mode** or **Dancer mode** (that tap starts the audio engine), then drop or
load audio files (MP3, M4A/AAC, WAV, AIFF; FLAC and OGG where the browser decodes them, which not every
iPhone/iPad version does).

Other scripts: `npm run typecheck`, `npm test`, `npm run build` (a static site in `apps/web/dist`, no server
code; deployable to any static HTTPS host), `npm run preview` (serves that build on http://localhost:5173 with the
service worker, so install and offline can be tried locally).

Dev note: Signalsmith Stretch (Dancer mode's key-locked stretcher) builds its AudioWorklet module by stringifying
its own source, so that code must reach the browser untranspiled. `apps/web/vite.config.ts` therefore excludes
`signalsmith-stretch` from dev-server pre-bundling and builds for ES2022 — do not lower either below ES2022, or
its class fields turn into an `__publicField` helper that does not exist inside the worklet and the key-locked
player never becomes ready.

Phones need HTTPS (AudioWorklet, service workers and Home Screen install only work in a secure context), so test
on an iPhone/iPad or Android device with a deployed build rather than the LAN dev server.

## Repo layout

```
apps/web            Vite + React UI (the app): start screen, DJ mode, Dancer mode
packages/engine     Audio engine: AudioWorklet deck processor, decks, mixer graph, key-locked StretchDeck
packages/analysis   Pure DSP: BPM/beatgrid detection, waveform overview (runs in a Worker)
packages/midi       Web MIDI wrapper + controller mapping schema (stub; Android/desktop only)
packages/library    IndexedDB/OPFS track store + metadata (stub)
docs/               Vision, feature parity, architecture, build plan
scripts/            Dev scripts (gen-icons.mjs: app icons for the manifest and Home Screen)
```

## Docs

- [docs/VISION_AND_PARITY.md](docs/VISION_AND_PARITY.md) — what MixDeck is (DJ + Dancer modes), target devices, what djay does, where we go beyond it, what is deliberately out of scope, and the hard platform limits
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — stack, audio graph, threading model, iOS / mobile audio, layouts, data model
- [docs/BUILD_PLAN.md](docs/BUILD_PLAN.md) — phased plan (Phase 0.5 = phone & iPad foundation) with tasks, acceptance criteria, estimates and risks

## Target devices

| Device | How it runs | Priority |
|---|---|---|
| iPhone | Safari (iOS 17.5 or later), installed to the Home Screen | Primary |
| iPad | Safari (iPadOS 17.5 or later), installed to the Home Screen | Primary |
| Android phones & tablets | Chrome, installed as an app | Primary |
| Desktop (Chrome / Edge, Safari, Firefox) | Browser tab or installed app | Secondary — supported, not optimised |

What iOS / iPadOS Safari lacks (and so every browser on iPhone and iPad, since they all use WebKit):

- **No Web MIDI** — MIDI controllers cannot be used on iPhone or iPad in the browser (Web MIDI exists on
  Android Chrome and desktop Chromium; controller support is planned for Phase 3).
- **No `setSinkId`** — no separate headphone-cue device; headphone cueing will use split output (master left,
  cue right), Phase 3.
- **Audio must be started by a tap** — nothing plays until you tap a mode button. After a call or Siri
  interrupts it, audio resumes on its own where the browser allows; otherwise tap **Tap to resume audio**. Start
  playback before locking the screen.

Every feature is feature-detected with a documented fallback; see
[docs/VISION_AND_PARITY.md](docs/VISION_AND_PARITY.md#target-devices) for the full list.

## Install on iPhone / iPad

MixDeck is an installable web app (PWA): once installed it opens full screen from the Home Screen like a native
app, and it works offline.

- **iPhone / iPad (Safari):** open the MixDeck URL in Safari → tap **Share** (on iOS / iPadOS 26 and later, if
  there is no Share button, tap **⋯** first, then **Share**) → **Add to Home Screen** → keep **Open as Web App**
  on (iOS / iPadOS 26 and later) → **Add**. Launch it from the new icon (not from a Safari tab) to get the
  full-screen app.
- **Android phone / tablet (Chrome):** open the URL → menu **⋮** → **Install app** (or accept the install prompt).
- **Offline:** launch the installed app once while online. On iPhone/iPad the Home Screen app has its own
  storage (service worker, cache and saved cues), separate from Safari, so a visit in a Safari tab doesn't count:
  that first launch from the icon is what caches it. After that everything the app needs is on the device, so it
  opens and plays with no connection (e.g. airplane mode). When you are online a new version downloads in the
  background (also when you switch back to the app) and is used the next time you open the app; a running
  session is never reloaded. Cues saved in a Safari tab do not carry over to the Home Screen app, so use the
  installed app.
- **Privacy:** songs you import and the cues you save stay on the device. Nothing is uploaded today; there is no
  server besides the static host that serves the app files. Future cloud sync and the set planner are opt-in.
- **Hosting:** installing and offline mode need the app to be served over **HTTPS** (on localhost,
  `npm run build && npm run preview` serves the production build with the service worker; `npm run dev` does not
  register it). The build is host-agnostic (relative paths), so it works at a domain root or under a sub-path
  such as `/mixdeck/`; see [docs/BUILD_PLAN.md](docs/BUILD_PLAN.md) Phase 0.5.
- **Icons:** regenerate the app icons with `npm run icons` (writes `apps/web/public/icons/`).
