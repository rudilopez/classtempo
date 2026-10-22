# Handoff — open work, in priority order

Original handoff baseline (2026-10-22): branch `dancer-v2`, working tree passes `npm run typecheck`, `npm test`
(123 tests) and `npm run build`. Production (`main`, GitHub Pages) still runs the previous release; nothing below
is deployed yet. The owner tests on an iPhone (Home Screen app) — anything touching the lock screen, audio
session or video must be confirmed there by the owner.

## Codex follow-through (2026-10-22)

The release candidate resolves all 11 original review findings, plus DJ master gain leaking into Dancer audio
and keyboard focus escaping Stage. Phone layouts also preserve 72×72 cue pads with safe areas. Browser checks
cover audio/video cues and restoration, 75% video rate with pitch preservation, uninterrupted video through
Stage open/close, DJ Demo/SYNC/LOOP/crossfader, fullscreen interruption recovery, inactive native media guards,
hidden-canvas inactivity and offline playback. The lock-screen scrubber still needs confirmation on a real iPhone.

The hidden research benchmark is at `#stems-benchmark`; see [STEMS_BENCHMARK.md](STEMS_BENCHMARK.md) for exact model
provenance, a real desktop execution result, device steps and licensing restrictions. The original ~80 MB/MIT
weight assumption was not confirmed: this four-stem export is 166 MB, and upstream restricts pretrained weights
to research despite the exporter's MIT label. Full section 2b requires both device acceptance and suitable weight
permission. A server fallback remains unapproved.

The original instructions/reports below are preserved as handoff history; completed findings are tracked in
[handoff/dancer-v2-reports.md](handoff/dancer-v2-reports.md).

## 1. Finish and ship "Dancer v2" (mostly built — verify, fix, deploy)

Owner's requests (verbatim): "on lock screen I can not move the sound bar. Can que show on lock? … what does the
sun icon next to load? Make the modes pills that get pressed to change. Also make dancer the default. … can we add
if video loaded it either fills the wave area or we have a full screen that shows play, restart and que only. also
are queue saved for songs or it starts over each time we load?" (que/queue = cue)

What was built (see [handoff/dancer-v2-reports.md](handoff/dancer-v2-reports.md) for the agents' full reports):
- **App shell**: no start screen; the app opens in Dancer mode; header segmented pills `[Dancer | DJ]`; both modes
  stay mounted (inactive one `hidden`) so songs stay loaded; switching pauses the mode being left;
  `Engine.create()` no longer awaits `resume()`, `Engine.unlock()` resumes inside the first gesture.
- **Lock screen**: root-cause analysis of the non-draggable scrubber is in the comment block at the top of
  `apps/web/src/platform/keepAlive.ts` with the fix applied; the Media Session second line shows the cue section
  ("Chorus · next: Bridge", `platform/cueLabel.ts`).
- **Video**: `VideoDeck` (native `<video>`, `preservesPitch` key lock — videos are NOT decoded into memory, phone
  videos can be hundreds of MB); video shows in the waveform area with a slim cue strip; **Stage** view = full
  screen with only video (or cue name + time), Play/Pause, Restart, launch-only cue pads, ✕.
- **"Screen on"** labelled wake-lock toggle (was the unlabeled sun icon); "Cues restored" message when a song with
  saved cues loads.

To do:
1. Work through the **11 review findings** at the end of [handoff/dancer-v2-reports.md](handoff/dancer-v2-reports.md).
   The fix pass was interrupted, so some may already be fixed — check each against the code.
2. Manually verify in a browser at 390×844, 844×390 and 1180×820: Demo audio flow; load a video (any MP4); tempo
   75 % → `video.playbackRate` 0.75 with `preservesPitch`; set/launch cues on audio and video; Stage view
   open/close (the same `<video>` element moves back to the waveform area); pills switch modes; DJ mode still
   works (both Demo tracks, Play, SYNC, LOOP, crossfader); reload → cues restored.
3. Update README / ARCHITECTURE / BUILD_PLAN to describe the above (the docs pass never ran). Mark the lock-screen
   scrubbing fix "needs confirmation on a real iPhone".
4. Merge to `main` to deploy; tell the owner what to test on the iPhone: lock-screen scrubbing, cue line on the
   lock screen, video + Stage view, pills.

## 2. Stems for Dancer mode (new scope, no Stems FX)

The owner wants VirtualDJ-style stem pads (reference: Vocal, Instru, Bass, Kick, HiHat, Acapella, Instrumental),
**without Stems FX**. Stems were previously "Deliberately out of scope" in docs/VISION_AND_PARITY.md — move them
into scope (streaming services stay out) and add a phase to docs/BUILD_PLAN.md.

### 2a. Feasibility spike first (≈ 2 days) — gate for the rest
- Run HTDemucs (4 stems: vocals, drums, bass, other; MIT-licensed — verify the licence of the exact weights you
  use) with `onnxruntime-web` on the WebGPU execution provider (WASM fallback) inside a Worker, on a 30 s and a
  4 min clip. Candidate ONNX exports exist on Hugging Face (search "htdemucs onnx"; e.g. chunked WebGPU exports);
  prefer fp16 weights to keep the download ≈ 80 MB.
- Ship it as a hidden route/page in the deployed app so the owner can run it on the iPhone and iPad; report
  separation time, peak memory, and whether WebGPU was used. iOS 26 Safari has WebGPU; older iOS only WASM.
- Decide with the owner: on-device (acceptable if a 4-min song splits in ≲ 2 min on the iPhone) vs. a server
  fallback (faster, but uploads songs and costs money — owner has not approved that).

### 2b. Build (≈ 3–4 weeks if the spike passes)
- **Model download on demand**: first tap on "Stems" asks "Download the stem engine (~N MB)? Best on Wi-Fi." —
  cache it (Cache Storage/OPFS), `requestPersistentStorage()`, works offline afterwards; re-download if evicted.
- **Separation** in a Worker: chunked inference with overlap-add, progress ("Splitting stems… 40 %"), cancel
  when another song loads; the song keeps playing normally while it splits.
- **Cache stems per song** in OPFS (16-bit PCM or compressed), keyed like cues (name|duration) + model version;
  LRU cap (e.g. 1.5 GB) and a "manage stems storage" list with delete. Second load of a song = instant stems.
- **Playback**: extend `StretchDeck` to play the 4 stereo stems through ONE Signalsmith node (8 channels) so they
  stay sample-locked with tempo/key lock and cues; `ChannelSplitterNode` → per-stem `GainNode` (10 ms ramps) →
  stereo mix. Check how `signalsmith-stretch` accepts >2 channels (its README: channel options).
- **Kick / HiHat** without a second model: split the drums stem at playback time with Linkwitz-Riley crossovers
  (two cascaded Butterworth biquads) at ~150 Hz and ~6 kHz into low / mid / high bands that sum back flat.
  Pads: **Drums** mutes all drums; **Kick** toggles the low band; **HiHat** toggles the high band.
- **Pads** (Dancer mode, a "Stems" panel; phone-portrait layout must still fit — a collapsible row or a tab next
  to the cue grid): Vocal, Instru (= "other"), Bass, Drums, Kick, HiHat + shortcuts Acapella (vocals only),
  Instrumental (all but vocals), All. Tap = toggle, lit = audible. Optional: "No vocals" in Stage view.
- **Scope limits for v1**: audio files only (videos use the native element path — stems for video would need the
  audio decoded; skip or allow only for files ≤ 150 MB later); DJ-mode stems later; no Stems FX.
- Tests: crossover sums to unity (offline render), stem gain routing, cache key/LRU logic, chunk overlap-add math.
- Acceptance: on the owner's iPhone a 4-min song splits without crashing, stems play in sync at 50–150 % tempo,
  pads respond instantly, the second load is instant, offline works after the model download.

## 3. Smaller follow-ups
- In-app hint "Press Play before locking the screen" (iOS won't start audio from the lock screen).
- Recent-songs library so songs don't have to be re-picked each session (Phase 2: File System Access / OPFS copies).
- DJ mode lock-screen controls (currently Dancer only).
