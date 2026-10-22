# Dancer v2 — reports from the interrupted Claude workflow

Generated from the workflow journal. `fix:r0` was interrupted: the findings below may be partly applied — re-check each one against the code.

## Codex resolution — 2026-10-22

All eleven numbered findings below were present in the handoff commit and are now resolved:

| Findings | Resolution | Validation |
|---|---|---|
| 1 | Recovery button portals inside native fullscreen; remains reachable in fallback Stage | Real Chromium fullscreen and denied-fullscreen interruption simulations |
| 2 | Inactive player and native keep-alive starts immediately pause | Browser direct native play attempts; keep-alive regression test |
| 3–4 | Stage blocks tempo arrows and dropped files | Keyboard and valid WAV drop checks |
| 5 | Hidden/covered waveform loops and hidden DJ display timers stop | Canvas draw counters across mode/Stage switches |
| 6, 9, 10 | Video editing fits phones; titles wrap on tablets; portrait tablet video grows | Phone/tablet layout and safe-area matrix |
| 7–8, 11 | Landscape eight-pad bar retains 72px targets; portrait video centers; audio Stage gets taller pads | Stage layout and screenshot review |

Additional review fixed the retained DJ MASTER muting Dancer audio (independent fixed Dancer gain) and Stage
keyboard focus escaping into background controls (focus containment and inert background, including recovery).
A graph regression verifies Dancer output while DJ master is muted. Browser tests verified focus restoration.

All-workspace typecheck, 131 tests and the production build pass.

96 base layout cases and 48 safe-area cases passed (mouse and touch; audio/video; normal/edit/Stage).
The final production-flow check also passed all seven required sizes, cue restoration, live video Stage
roundtrip, video tempo/pitch settings and DJ transport/mixer controls, with no page errors. Production service
worker testing confirmed offline Demo playback and no model/runtime download from the normal app.

**Still device-only:** lock-screen scrubbing, paused scrubber limitations, lock-screen Pause → Play, cue metadata,
headphone controls and native iPhone video interruptions. No desktop simulation establishes these outcomes.

## lockscreen report

**Lock-screen scrubbing on iOS: root cause, fix, and wiring for DancerMode**

Status: the scrubber fix and the contract D helper are done in my files only. They change nothing on the phone until the DancerMode agent wires them in (steps below). `npx vitest run apps/web/src/platform` passes (84 tests, 7 files). `npm run typecheck -w apps/web` has one error, in a file another agent is editing: `src/App.tsx(219,37)` passes `active`, which DancerMode's Props don't have yet (contract C). My files have no type errors. I have not tested this on an iPhone or in Safari, only in the Chromium browser pane.

**Root cause** (WebKit main, read 2026-10-22, "l." = line)
1. Dragging the scrubber needs MediaRemote's SeekToPlaybackPosition command. `platform/cocoa/RemoteCommandListenerCocoa.mm` `updateSupportedCommands` leaves every seek command out when `supportsSeeking()` is false (l.113-114), and the command handler refuses them too (l.181-185).
2. That flag follows whichever session most recently *started* playback:
   - `MediaSessionManagerCocoa.mm` `scheduleSessionStatusUpdate` (l.264-275) writes `computeSupportsSeeking()` (l.268). This runs after every playback start (l.278) and every characteristics change (l.359), which includes every `setPositionState`, metadata and handler change.
   - `MediaSessionManagerInterface.cpp` `computeSupportsSeeking` (l.872-878) asks `currentSession()`. That is whichever session started playback last (`PlatformMediaSessionManager.cpp` l.90-104, called from `startSessionAdmission` l.520-524). Sessions start in the order they ask (`sessionWillBeginPlayback` l.478-509).
   - The only other writer is `NowPlayingManager.cpp` l.122-124, and it runs only when an update is actually sent. Unchanged updates are skipped (`MediaSessionManagerCocoa.mm` l.717-720, `shouldUpdateNowPlaying` l.530-612).
3. Two sessions that cannot seek were starting after our silent `<audio>`:
   - **The page's own Media Session** (the main cause). Since WebKit 305995@main (Jan 2026, iOS 26.4+), `MediaSession.cpp` `setPlaybackState` starts a playback session of its own when `playbackState` becomes `'playing'` (l.289-290). That session cannot seek (`MediaSession.h` l.200). DancerMode set `'playing'` in `syncMedia()` right after `keepAlive.start()`, so it started last. Every later `setPositionState` (each seek, every 5 s) then rewrote "no seeking", and the matching update was skipped as unchanged.
   - **The AudioContext** also cannot seek (`AudioContext.h` l.145). Its `resume()` starts asynchronously (`AudioContext.cpp` l.300-378, l.530), so it lands after an `<audio>.play()` from the same tap.
   - An element that is already playing never starts again (`PlatformMediaSession.cpp` l.286, `HTMLMediaElement.cpp` l.4768). The only way to put it back first is `pause()` + `play()`.
4. **`loop` is a second, separate bug.** Each 10 s wrap (`MediaPlayerPrivateAVFoundation.cpp` `didEnd` l.727-743, then `HTMLMediaElement.cpp` l.6322/l.6332 and `finishSeek` l.4256) makes `MediaElementSession.cpp` l.1863-1878 overwrite the page's position state with the element's own 0–10 s time (l.1871). So the lock-screen playhead jumped back to 0:00–0:10 every 10 s. Any seek of the element does the same.
5. **Ruled out:**
   - Live stream / infinite duration: `setNowPlayingInfo` (l.423-500) sends no live flag, and the duration comes from the position state (`MediaSession.cpp` l.599-606). Loop's infinite duration (`HTMLMediaElement.cpp` l.10485) is not used for Now Playing.
   - The element's own 10 s length: overridden by the position state.
   - Registering handlers before the element plays: supported commands are per page (`MediaSession.cpp` l.298-360). They are lost only if registered while the page has no media session at all (`NowPlayingManager.cpp` l.145 / l.47).

**What I built**
- `keepAlive.ts`:
  - The silent WAV is now as long as the song and does not loop (`ceil(duration)+1` s, at least 10 s so Android Chrome still shows its notification).
  - Its position and rate follow the song, so anything WebKit copies from it is correct.
  - `claim()` re-takes "started last" with `pause()`+`play()` in one task (silent). It runs automatically when the AudioContext reaches `'running'` while the keep-alive plays. It only acts on WebKit (`navigator.audioSession` present) and only while the page is visible, because a hidden page may refuse the `play()`.
  - The evidence block is at the top of the file.
- `mediaSession.ts`: `setPlaybackState` now returns whether this call moved into `'playing'`; added `setNowPlayingArtist` and `refreshHandlers`.
- `cueLabel.ts`: contract D, as specified.

**Browser-pane check (Chromium):** a 95.4 s song gave a 97 s non-looping file; it started at the synced 30 s at rate 0.9, a seek to 60 s worked, unloading went back to the 10 s loop, and `dispose()` removed the element. No console errors. With `navigator.audioSession` faked, both the automatic claim on the context going to `'running'` and an explicit `claim()` re-played the element and it kept playing.

**New API (all additive; existing calls behave as before)**
- `keepAlive.ts`:
  - `createKeepAlive(options?: { context?: AudioContextLike | null; onStarted?: () => void })`. `AudioContextLike` is `{ state; add/removeEventListener('statechange') }`; a real `AudioContext` fits.
  - `start()`, `stop()`, `dispose()`: unchanged signatures. `start()` now also places the element at the synced position first.
  - `setTrack(duration: number | null): void`: builds the file now, outside the tap. Pauses the element and resets its position to 0. `null` goes back to the 10 s loop and frees the long file. Songs over 20 min loop a 20-min file and their position is not followed. Memory is 16 KB/s, so a 5-min song is 4.8 MB, capped at 19.2 MB.
  - `sync(position: number, rate: number): void`: sets the rate (clamped 0.25–4) and seeks only when more than 0.25 s off.
  - `claim(): void`
  - `silentTrackPlan(duration)` is also exported.
- `mediaSession.ts`:
  - `setPlaybackState(state): boolean`: true only when this call moved into `'playing'`.
  - `setNowPlayingArtist(artist: string): void`: changes only the second line, so artwork is not fetched again.
  - `refreshHandlers(): void`: re-applies the last `setHandlers` map; no-op after `clearMediaSession`.
- `cueLabel.ts`: `NamedCue`, `CueSection`, `cueSection(cues, position)`, `lockScreenLine(section, hasCues)`, `SECTION_EPSILON = 0.05`, `NO_CUES_LINE`.
  - A cue at or within 0.05 s past the playhead counts as current, so "next" is exactly what the lock-screen next button launches.
  - Ties go to the lower pad index.

**Wiring for DancerMode**
1. Create the keep-alive with `useState(() => createKeepAlive({ context: engine.ctx, onStarted: refreshHandlers }))`.
2. After an audio song loads (keep the existing `keepAlive.stop()` before load), call `keepAlive.setTrack(track.duration)`. On a failed load, on unload, or when a video is loaded, call `keepAlive.setTrack(null)`. Never start the keep-alive for videos: the `<video>` is the media element.
3. Every start of playback (tap, key, lock-screen play/previous/next, cue launch), before `player.play()` / `jumpTo()`:
   `engine.unlock(); setPlaybackState('playing'); if (player.kind === 'audio') void keepAlive.start();`
   The order matters: `setPlaybackState('playing')` must come before `keepAlive.start()`, and likewise before the `<video>`'s `play()`.
4. In `syncMedia`, in this order:
   - `if (player.kind === 'audio') keepAlive.sync(player.position, player.tempo);`
   - `if (setPlaybackState(player.playing ? 'playing' : 'paused') && player.kind === 'audio') keepAlive.claim();`
   - then `setPosition(...)` as today.
   Keep calling `syncMedia` after play, pause, seek, launch, tempo change, load, end, from `onPlayingChange`, and every 5 s.
5. Pause stays as it is: `player.pause(); keepAlive.stop(); syncMedia()`. On `onPlayingChange(false)` caused by the OS, also call `keepAlive.stop()`.
6. Lock-screen cue line (contract D):
   - Compute `line = lockScreenLine(cueSection(song.cues, player.position), song.cues.some(c => c !== null))`.
   - Keep the last value in a ref and call `setNowPlayingArtist(line)` only when it changes.
   - Check it in `syncMedia`, every 250 ms while playing, and when `song.cues` changes.
   - At registration, use `setNowPlaying({ title, artist: line })`, set the ref to `line`, and reset the ref whenever the session is cleared or registered again.

**Remaining limits**
- **Paused (WebKit itself, not fixable from these files):** while paused with the AudioContext still running, `sessionWillEndPlayback` (`MediaSessionManagerInterface.cpp` l.640) puts the paused element behind the running AudioContext. So the scrubber cannot be dragged while paused.
- **Lock-screen Play after a pause may not reach our handlers:** commands go to the first eligible session in that order (`processDidReceiveRemoteControlCommand` l.771), and an AudioContext with audioSession `'playback'` is eligible (`AudioContext.cpp` l.576/l.638). If so, the AudioContext gets the Play and nothing resumes. Please have the owner test Play after Pause from the lock screen. The only remedy found is an engine change: suspend the AudioContext before pausing the keep-alive when nothing else plays, and resume it before `keepAlive.start()`.
- **Videos:** if the AudioContext's resume lands after the video's `play()` in the same tap, seeking stays off until the next play. This is unlikely because `engine.unlock()` runs on pointerdown, before click.

Files:
- /Users/rudilopez/mixdeck/apps/web/src/platform/keepAlive.ts
- /Users/rudilopez/mixdeck/apps/web/src/platform/keepAlive.test.ts
- /Users/rudilopez/mixdeck/apps/web/src/platform/mediaSession.ts
- /Users/rudilopez/mixdeck/apps/web/src/platform/mediaSession.test.ts
- /Users/rudilopez/mixdeck/apps/web/src/platform/cueLabel.ts
- /Users/rudilopez/mixdeck/apps/web/src/platform/cueLabel.test.ts

## video-engine report

Contracts A and B are in place. The engine typecheck passes, `npx vitest run packages` passes 25/25, and the full `npx vitest run` passes 86/86. I tested VideoDeck in the browser with both the MP4 and the WebM and every check you listed passed.

**Exported API** (`packages/engine/src/index.ts`): the existing exports stay, plus `export type { DancerPlayer }` and `export { VideoDeck }`.

- **`DancerPlayer`** (`packages/engine/src/dancer-player.ts`) matches contract A exactly.
- **`StretchDeck implements DancerPlayer`**
  - Adds `readonly kind = 'audio'` and `onPlayingChange`. `release()` now clears `onPlayingChange` too.
  - `onPlayingChange` fires inside `schedule()`, after the message is sent, only when the playing state actually changes. That covers play, pause, jumpTo, load or unload while playing, and the end of the track.
  - At the end of a track the order is `onPlayingChange(false)`, then `onPosition`, then `onEnded`.
- **`class VideoDeck implements DancerPlayer`** (`packages/engine/src/video-deck.ts`)
  - Members: `kind 'video'`, `readonly element: HTMLVideoElement`, `get track/playing/position/tempo`, `onPosition`, `onEnded`, `onPlayingChange`, `load(file: Blob, name: string): Promise<void>`, `play`, `pause`, `toggle`, `seek`, `jumpTo`, `setTempo`, `unload`, `dispose`.
  - Also exported for tests: `clampTempo(rate): number | null`, `clampTime(s, duration)`, `isUsableDuration(d)`, `mediaErrorMessage(code, name)`.

**VideoDeck behaviour the other agents should know:**
- **`playing` comes from the element's own events.** It listens to play, pause, `webkitendfullscreen`, ended and error. When an event arrives, it checks the element's actual `paused` state rather than trusting the event, so a queued 'play' that a `pause()` overtook does not flip the state back.
- **`play()` sets `playing` true immediately.** If the browser refuses (NotAllowedError, AbortError, NotSupportedError), the error is swallowed and `onPlayingChange(false)` follows.
- **Load details:**
  - `load()` sets `src` to the object URL plus `#t=0.001` (the usual fix for iOS showing the first frame), then calls `element.load()` explicitly. As a result, `position` reads 0.001 right after a load.
  - The playback rate is re-applied after load because loading resets it.
  - A file whose header gives an infinite duration (older MediaRecorder WebM) has its real length worked out before the load resolves.
  - Errors reject with readable messages, e.g. "This browser can't play “x”. Try an MP4 (H.264) video."
  - A load replaced by a newer `load` or `unload` resolves without a track, like `StretchDeck.load`. A load that never finishes rejects after 20 s.
- **Position reports** come about 20 times a second while playing, plus on seek, pause and end. If frame callbacks stop arriving for over 300 ms while playing, it switches to `requestAnimationFrame` until the next play. The element's `timeupdate` events also send reports when the tab is in the background.
- **`dispose()`** unloads, clears the callbacks, removes the listeners and takes the element out of the page.

**Browser results** (Chromium pane):
- **MP4:** loaded in 95 ms with duration 60, 640×360, and the element set up as specified (inline, preload auto, no controls, remote playback off, not muted, `preservesPitch` true).
- **Tempo:** `setTempo(0.75)` gave `playbackRate` 0.75, `defaultPlaybackRate` 0.75 and `preservesPitch` true. Position advanced at 0.771× real time at 0.75 once playing. Reports came at 18–20 a second, 50 ms apart.
- **Seeking:**
  - `seek(30)` while paused landed on exactly 30 and it stayed paused.
  - `jumpTo(10)` played from 10.0 and reached 10.80 after 1 s, firing `playing:true` once.
  - `seek(30)` while playing kept playing.
- **Pausing:** `pause()` stopped the position and fired `playing:false`.
  - Calling `element.pause()` directly (standing in for an OS pause) fired `playing:false` when the pause event arrived.
  - Calling `element.play()` directly fired `playing:true`.
- **End of track:** after `seek(59.5)` and `play()`, events came as `playing:true`, `playing:false`, `ended:60`, with the last report at 60. Playing again from the end restarted at 0.
- **`unload()`:** removed the src attribute and revoked the URL (fetching it afterwards fails). networkState and readyState went to 0 and it fired `playing:false`.
- **WebM:** loaded in 8 ms with duration 60.008. `jumpTo(10)` at 1.25× played with `preservesPitch` true, and it reached the end with `ended:60.008`.
- **Errors and replaced loads:**
  - Loading a text blob rejected with the readable message and left no src.
  - Of two loads in a row, the first resolved quietly and the second won.
  - `unload()` during a pending load resolved it with no track.
- **Frame-callback fallback:** in Chromium, video frame callbacks still fire for `display:none` and detached elements. With them stubbed out, the switch to animation frames worked and the next play went back to video frames.
- **Cleanup:** I disposed the deck and closed my tab. The only console error was my deliberate fetch of the revoked URL.

**Notes for the agent building the UI:**
- **Detaching the element pauses it** (that is the spec), and `onPlayingChange(false)` reports it. Moving it to another parent in the same task keeps it playing, which I tested. So the full-screen view can re-parent the element safely, but should not leave it detached.
- **`npm run typecheck -w apps/web` fails right now** with `App.tsx(219,37): Property 'active' does not exist` on DancerMode's props. That is another agent's contract C work in progress, not these files.
- **Untested on a device:** whether iOS Safari loads a video's metadata without a tap could not be checked in Chromium. The explicit `load()` call is the mitigation.

Files:
- /Users/rudilopez/mixdeck/packages/engine/src/dancer-player.ts
- /Users/rudilopez/mixdeck/packages/engine/src/video-deck.ts
- /Users/rudilopez/mixdeck/packages/engine/src/video-deck.test.ts
- /Users/rudilopez/mixdeck/packages/engine/src/stretch-deck.ts
- /Users/rudilopez/mixdeck/packages/engine/src/index.ts

## shell report

Contract C is done: the app opens straight into Dancer mode, the header has a [Dancer | DJ] pill switch, and the engine starts without a tap. `npm run typecheck -w packages/engine` passes and all 67 Vitest tests pass. `apps/web` typecheck has one error, which we expected (below).

**What changed**
- **`packages/engine/src/engine.ts`**
  - `Engine.create()` no longer waits on `ctx.resume()`.
  - If the worklet module fails to load, it closes the new context before rethrowing, so a failed start doesn't leave a context behind.
  - New `unlock(): void` calls `ctx.resume()` synchronously, fire-and-forget with errors swallowed. It does nothing when the context is already 'running' or is 'closed'.
- **`apps/web/src/App.tsx`** (rewritten)
  - There is no start screen. The engine is created on mount and kept in a ref, so StrictMode's double effect run and Fast Refresh still make only one AudioContext. Until it is ready a short "Loading…" splash shows. If it fails, the splash shows "Audio could not start: …" with a **Try again** button.
  - Mode defaults to `'dancer'` on every launch, and nothing is persisted.
  - The pills are a `role="radiogroup"` with `role="radio"` / `aria-checked` buttons. Only the active pill is in the tab order, and Arrow keys, Home and End move between them.
  - Those pill keys, and Space/Enter on a pill, don't reach Dancer's window shortcuts (it uses ←/→ for tempo, Home for restart, Space for play).
  - A pill tap calls `engine.unlock()`. Leaving DJ pauses any playing deck and sets `playing: false` in `setA`/`setB`.
  - Both modes stay mounted as `<main hidden>`, and Dancer gets `<DancerMode engine={engine} active={mode === 'dancer'} />`.
  - A capture-phase listener for pointerdown, pointerup, touchend and keydown calls `unlock()`. It removes itself once the context reaches 'running'. I added pointerup because by the HTML spec a touch pointerdown doesn't unlock audio; the touch gesture counts on pointerup or touchend.
  - The meta readout is now a small `AudioMeta` that re-renders on `statechange`, because output latency is only known once the context runs. The "Tap to resume audio" overlay is unchanged.
- **`apps/web/src/shell.css`** (new, imported from App.tsx)
  - Splash styles, plus `.app > main[hidden] { display: none }`.
  - The segmented control is a 44 px pill per mode, with a transparent 4 px border so the full 44 px stays tappable. That keeps the phone header at 49 px, the same as before.
  - Active pill is filled with `--a` and black text. It has `touch-action: manipulation`, a white focus ring, hover only under `hover: hover`, and no transition with reduced motion. Pills get roomier from 600 px wide.
- **`apps/web/src/styles.css`**: only deletions — the `.gate*`, `.modes`, `.mode*`, `.mode-tag` and `.modes-btn` rules. `header`, `.logo`, `.head-left`, `.meta`, `.error` and the safe-area padding are untouched.

**Expected type error (apps/web)**
`src/App.tsx(219,37): TS2322 Property 'active' does not exist on type 'IntrinsicAttributes & Props'`. It's only because `DancerMode` doesn't take `active` yet. Until it does, switching from Dancer to DJ does not pause Dancer playback.

**What I checked in the browser** (my own tab, now reset to desktop and closed)
- **390×844:** after the splash it opens on Dancer with the Dancer pill filled. Header is 49 px, with the 44 px pills right after the logo. No horizontal scroll, and the meta text is hidden.
- **Switching with Demo tracks:**
  - Loaded Demo on decks A and B, played A, switched to Dancer. Both decks reported paused, and the DJ `<main>` was hidden (display none) and dropped out of the accessibility tree.
  - Switching back, the tracks were still there, A sat paused at 0:06.4, and the play button showed ▶.
  - Arrow keys switched modes and moved focus; the white ring was visible. Dancer's tempo stayed at 100%.
- **360 px wide:** the switch is 146×44 next to the logo, with no overflow.
- **1180×820:** header is 65 px with roomier pills (97 / 84 px wide) and the meta reads "48 kHz · ~173 ms out". Dancer is in its two-column layout, and DJ shows deck │ mixer │ deck.
- **Suspended start:** this browser pane lets audio play without a tap, so I forced the suspended case in an iframe by patching AudioContext.
  - Only one context was created, it started 'suspended', and the app rendered in Dancer with Demo enabled.
  - The first pointerdown started the context. After I suspended it again, further events left it suspended, so the listener had removed itself.
  - Separately, `Engine.create()` plus `getStretchDeck()` became ready within 9 ms while suspended in Chromium. This hasn't been checked in Safari; if WebKit holds it until the first tap, that tap starts it.
- **Error path:** a forced worklet failure showed the error splash and closed the failed context. **Try again** then loaded the app.
- **"Tap to resume audio":** I played a deck, blocked `resume()` and suspended the context. The overlay appeared after about 500 ms, tapping it resumed audio and it went away. No console errors.

**For the DancerMode agent:** since Dancer now stays mounted while hidden, its window keydown shortcuts (1–8, Space, ←/→, Home) still fire in DJ mode. With `active` false it should ignore them, release the wake lock and stop the keep-alive, as well as pausing and clearing the Media Session.

**Left for someone else:** README.md and docs/ARCHITECTURE.md still describe the start screen and starting audio by tapping a mode. A stale comment in styles.css ("keep logo, mode and Modes only") is also left as is, because I was told to make no other changes there.

Files: `/Users/rudilopez/mixdeck/apps/web/src/App.tsx`, `/Users/rudilopez/mixdeck/apps/web/src/shell.css`, `/Users/rudilopez/mixdeck/apps/web/src/styles.css`, `/Users/rudilopez/mixdeck/packages/engine/src/engine.ts`

## dancer-ui report

The Dancer-mode UI is finished and wired to the three foundation pieces (video player, keep-alive / lock screen, app shell). `npm run typecheck`, `npx vitest run` (123 tests in 11 files) and `npm run build` all pass. I checked it in my own browser tab at 390×844, 844×390 and 1180×820, plus a few other phone and iPad sizes. Nothing has been tried on a real iPhone, iPad or Android device yet, and full screen couldn't be tested here.

**What I built**
- **Player switching:**
  - `DancerMode` now takes `{ engine, active }` and drives one player at a time: the StretchDeck for audio files and Demo, a VideoDeck for videos (created on first use, disposed on unmount).
  - The file input now accepts video. Videos are recognised by MIME type, or by extension when there is no type (`dancer/media.ts`, with tests).
  - Loading the other kind unloads the previous player only once the new load has worked, so a failed video load leaves an audio song loaded.
  - The play button follows `onPlayingChange`, so a pause the OS makes (e.g. iOS locking the screen) shows straight away.
  - The silent keep-alive is used only for audio, never for video.
- **Leaving Dancer mode:** it pauses, stops the keep-alive, clears the lock screen, closes Stage, turns "Screen on" off and ignores the keyboard. Coming back re-registers the lock screen.
- **Lock screen (contract D):**
  - Title is the song name; the second line is the cue line, e.g. "Chorus · next: Cue 3". It is checked 4×/s while playing and on every seek, launch and cue edit, and only written when the section changes.
  - Before starting the video or keep-alive, the code sets the lock screen to "playing"; if that call reports a change while the keep-alive is already playing, it calls `keepAlive.claim()`.
  - The keep-alive is created with `{ context: engine.ctx, onStarted: refreshHandlers }`, `setTrack(duration)` on an audio load, `setTrack(null)` on a video load or failed load, and `sync()` wherever the position is synced.
  - The lock-screen controls are registered again each time a video starts playing.
  - The lock-screen agent's instructions arrived cut off after "Never start the keep-alive for vid", so I took the ordering rule from the comment at the top of `mediaSession.ts`.
- **Video in the waveform area:**
  - New `VideoView.tsx` moves the one `<video>` element between the waveform area and Stage view.
  - The video is black, letterboxed, and capped at its own aspect ratio. A 28 px strip under it shows cue markers and the playhead, and you can tap or drag it to seek.
  - Tapping the picture plays or pauses; a ▶ badge shows while paused.
  - BPM and peaks are worked out in the background only when the file is ≤ 150 MB and also ≤ 10 minutes long (I added the length cap because long, small videos would still use a lot of memory). Otherwise the clock row shows "tempo %" instead of a BPM.
- **`Waveform.tsx`:** two new optional props, `className` and `scrub` (drag to seek). DJ mode doesn't use them and is unchanged.
- **Stage view (`StageView.tsx`):**
  - Rendered on top of the page. It shows only the video (or, without one, the cue name and elapsed time in large type), Play/Pause, Restart, the set pads (72 px+, in pad colours, launch-only, "Set cues first" when there are none) and a 48 px ✕.
  - Portrait: video on top, controls at the bottom. Landscape: video fills the screen with a translucent bar at the bottom.
  - It asks for full screen where the browser supports it and leaves full screen on close. Escape, or leaving full screen, closes it.
  - Keys 1–8, Space and Home still work; 1–8 only launch here and never set a cue.
- **Sun icon:** it is now a labelled "☀ Screen on" toggle (`aria-pressed`), filled with the accent colour and a glow when on. It stays in the song row. On phones the song name can wrap to two lines to make room.
- **Stage button:** it sits next to Play and Restart (an SVG four-corners icon plus "Stage", because the ⛶ character may not display on every phone).
- **Cues:** still saved per song. Loading a song with saved cues shows a toast, "Cues restored · N saved for this song", which also showed after a fresh page load. The wider-screen hint now says "saved per song".

**What I saw in the browser**
- **Demo audio:** the keep-alive got a 129 s non-looping silent file and kept its position within 0.25 s of the song. Over 6 s of playback the lock-screen line was written once, exactly when the song crossed a cue.
- **MP4:**
  - Duration 60, 640×360, not muted, BPM 120 from the background analysis.
  - Tempo 75 % gave `playbackRate` 0.75 with `preservesPitch` true; it played at 0.752 s per second and showed 90 BPM.
  - Setting and launching cues worked and was saved under `dance-120bpm.mp4|60.00`; the lock-screen line updated each time.
  - Pausing or playing the element directly (standing in for the OS) updated the UI and lock screen.
  - Dragging on the strip seeked.
- **WebM:** played as well.
- **Stage view:** the same element moved in and out while playing (only one `<video>` on the page). Pads, Space, 1, Home and Escape worked, and focus went back to the Stage button.
- **Switching modes:** going to DJ paused playback and cleared the lock screen, and Space did nothing there. Coming back re-registered the lock screen.
- **Layout:** no scrolling at 390×844, 430×932, 360×780, 390×763 (iPhone screen minus its safe areas), 844×390, 750×369, 820×1180, 768×1024 and 1024×1366. At 390×844 the video is 172 px tall and pads are 86 px (they were 151 px with the waveform).
- **Console:** no errors after a fresh page load.

**Decisions for you**
- **Stage sits under the "Tap to resume audio" overlay** (z-index 90 vs 100), not above everything as specified, so that button stays reachable during Stage. On iPad and Android in full screen, only the Stage view is on screen and that overlay can't appear at all; tapping Play in Stage resumes the audio instead.
- **Phone landscape with a video changes layout:** tempo moves above the pads so the video has room, pads shrink to as little as 56 px, and the tempo block hides while "Edit cues" is on. Without this the video was about 40 px tall.

**Open items**
- Full screen couldn't be tested: the browser tab never answers the request, so only "it doesn't break" is checked. The dev-only double request React's strict mode would make is guarded.
- `dancerAudio.ts` needed no changes: it still points at the StretchDeck, which is empty and paused while a video plays.
- I didn't edit `README.md` or `docs/ARCHITECTURE.md` (not my files). They still describe the start screen, "Keep screen on" as an icon, the looping 10 s keep-alive, and say nothing about video or Stage.
- I removed the test cues I created for the MP4 in the browser's storage; the existing "Demo 120 BPM" cues were already there and I left them.

Files are in /Users/rudilopez/mixdeck/apps/web/src:
- dancer/DancerMode.tsx
- dancer/StageView.tsx
- dancer/VideoView.tsx
- dancer/dancer.css
- dancer/media.ts
- dancer/media.test.ts
- components/Waveform.tsx
- styles.css

## integrate report

{"status":"all_green","edits":[],"summary":"All three checks passed on the first run, so I didn't edit any files. The diff only touches apps/web, packages/engine and .gitignore. The .gitignore change is one added line, 'test-media/'. No untracked files exist outside apps/web or packages, and the build's dist/ output is gitignored.","commands":{"npm run typecheck":"tsc --noEmit ran in the web, analysis, engine, library and midi workspaces with no errors (exit 0).","npx vitest run":"Test Files 11 passed (11) | Tests 123 passed (123). Includes cueLabel.test.ts (12), video-deck.test.ts (19), keepAlive.test.ts (19), mediaSession.test.ts (11) and media.test.ts (8).","npm run build":"vite v6.4.5. 62 modules transformed. dist/index.html 2.02 kB, dist/assets/analysis.worker-BjzbVnb6.js 2.26 kB, dist/sw.js 4.09 kB, dist/assets/index-BsPkssPU.css 23.05 kB, dist/assets/index-DfCzMadO.js 379.56 kB (gzip 132.20 kB). Built in 500ms with no warnings.","git diff --stat":"12 files changed, 1456 insertions(+), 472 deletions(-). Changed files: .gitignore (+1), apps/web/src/App.tsx, components/Waveform.tsx, dancer/DancerMode.tsx, platform/keepAlive(.test).ts, platform/mediaSession(.test).ts, styles.css, packages/engine/src/engine.ts, index.ts and stretch-deck.ts. Untracked files: apps/web/src/dancer/{StageView.tsx, VideoView.tsx, dancer.css, media.ts, media.test.ts}, apps/web/src/platform/{cueLabel.ts, cueLabel.test.ts}, apps/web/src/shell.css and packages/engine/src/{dancer-player.ts, video-deck.ts, video-deck.test.ts}."},"contract_spot_checks":{"A":"packages/engine/src/index.ts exports the DancerPlayer type. StretchDeck has onPlayingChange and fires it when the playing state changes (stretch-deck.ts:239).","B":"index.ts exports VideoDeck, which has onPlayingChange (video-deck.ts:93, fired at :320).","C":"Engine.unlock(): void calls ctx.resume() without awaiting it and swallows errors (engine.ts:109-115). DancerMode props are { engine: Engine; active: boolean } (DancerMode.tsx:31-37).","D":"apps/web/src/platform/cueLabel.ts exports NamedCue, CueSection, cueSection(cues, position), lockScreenLine(section, hasCues) and NO_CUES_LINE = 'No cues yet'."}}

## Review findings (round 0) — apply any that are still open

1. **[bug] apps/web/src/dancer/StageView.tsx:48** (code) — When Stage view goes full screen (iPad, Android, desktop), the "Tap to resume audio" overlay can't be seen or tapped. The Stage root enters the top layer. The overlay is a z-index:100 sibling under .app, and no z-index puts it above a fullscreen element. Both StageView's comment and dancer.css:187 claim the overlay stays reachable, which is wrong whenever the full-screen request succeeds.
   - Evidence: StageView.tsx:44-53 calls el.requestFullscreen() on the portal root, and StageView.tsx:68-69 says it renders "below the 'Tap to resume audio' overlay, which must stay reachable". The overlay itself is rendered at App.tsx:227-232 inside .app, outside the fullscreen element, with z-index 100 (styles.css:374) against the stage's 90 (dancer.css:193). watchAudioContext calls onNeedsGesture(true) when the context stays 'interrupted' or 'suspended' while isDancerPlaying() is true (audioRecovery.ts:84-90). Scenario on iPad: play an audio song, open Stage, then a Siri or FaceTime interruption ends and auto-resume is refused. The overlay mounts but stays hidden. StretchDeck._playing is still true, so the Stage button reads "Pause" while the audio is silent. The first tap pauses, because togglePlay sees playing=true, and only a second tap reaches startPlayback → engine.unlock(). The one-shot unlock listener is already disarmed (App.tsx:70-72).
   - Fix: Make the overlay reachable in full screen. One option: render the resume button through a portal into document.fullscreenElement ?? document.body, re-rendering on fullscreenchange. Another: pass needsGesture into StageView and exit full screen (or show its own resume button) while it is true. As a fallback, StageView's buttons could call engine.unlock() / restartDancerKeepAlive() before toggling. Then correct the comments at StageView.tsx:68 and dancer.css:187.
2. **[bug] apps/web/src/dancer/DancerMode.tsx:224** (code) — When the user leaves Dancer mode, its media is paused and every Media Session handler is cleared, but the VideoDeck <video> (and the keep-alive <audio>) stay loaded. With no page handlers, the browser's default play action resumes the media element directly: Android Chrome's media notification, hardware media keys, and possibly a headset or lock-screen play. Nothing re-pauses it while the mode is inactive, so the hidden Dancer video can start playing over DJ mode.
   - Evidence: The inactive effect (DancerMode.tsx:268-275) only calls playerRef.current?.pause() and keepAlive.stop(). The Media Session cleanup calls clearMediaSession(), which sets every action handler to null (mediaSession.ts:143-148), so the UA's default play/pause behaviour applies. The video keeps its src while hidden (no unload). A 'play' event then goes through VideoDeck.syncPlaying (video-deck.ts:324-327) to onPlayingChange(true). DancerMode's handler (DancerMode.tsx:224-230) just calls setPlaying(true), refreshHandlers() (a no-op, since registered is null) and syncMedia(), which returns early when inactive. Nothing checks activeRef or pauses. The same path can start the silent keep-alive (its onStarted is refreshHandlers, also a no-op). The lock screen or notification then shows 'playing' while in DJ mode.
   - Fix: Guard on activeRef in the player callback. In player.onPlayingChange, if (isPlaying && !activeRef.current) { player.pause(); return; }. Do the same for the keep-alive by wrapping onStarted: () => activeRef.current ? refreshHandlers() : keepAlive.stop(). Another option is to register no-op play handlers while inactive instead of clearing them, though that keeps lock-screen controls visible.
3. **[spec] apps/web/src/dancer/DancerMode.tsx:613** (code) — In Stage view, the arrow keys still change tempo. Stage is specified as play, restart and cue launch only, with no tempo control. A keyboard user (iPad with a keyboard, desktop) can silently change the tempo with no visible feedback.
   - Evidence: The window keydown handler passes h.stageOpen only to pressPad (line 610: h.pressPad(Number(e.key) - 1, h.stageOpen)). The ArrowLeft/ArrowRight branches (lines 613-616) call h.changeTempo(h.tempo ± 1) whatever h.stageOpen is. StageView renders no tempo readout (StageView.tsx:124-162), and its doc comment says "No tempo, no editing, no loading" (StageView.tsx:66-67).
   - Fix: In onKeyDown, skip the ArrowLeft/ArrowRight branches when h.stageOpen is true, for example: } else if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && !h.stageOpen) { ... }.
4. **[quality] apps/web/src/dancer/DancerMode.tsx:673** (code) — Dropping a file on the Stage view overlay loads it. StageView is a portal, but React synthetic events still bubble through the React tree to the Dancer <section>'s onDragOver and onDrop. Stage view is meant to have no loading, and dropping an audio file while a video is on stage swaps the stage to the no-video layout mid-performance.
   - Evidence: StageView is rendered as a child of <section onDragOver onDrop={onDrop}> (DancerMode.tsx:666-673 and 816-830) via createPortal(..., document.body) (StageView.tsx:114-167). React propagates events from a portal to its React ancestors. onDragOver calls preventDefault (which allows the drop), and onDrop calls loadFile (lines 641-646) with no stageOpen check.
   - Fix: In onDrop and onDragOver, ignore events while stageOpen is true (if (stageOpen) return; before preventDefault). Alternatively, stop propagation of drag events at the StageView root.
5. **[quality] apps/web/src/components/Waveform.tsx:126** (code) — Both modes now stay mounted, so the hidden mode's waveform canvases keep redrawing on every animation frame for the life of the page. In the default Dancer mode, DJ's two hidden Waveforms run a rAF loop that calls getComputedStyle every frame, which is avoidable battery drain on phones. Before this change, only the visible mode was mounted.
   - Evidence: App.tsx:218-226 mounts DancerMode and both DeckViews (each with a Waveform) at all times and hides the inactive <main> with display:none (shell.css:37-39). Waveform's effect re-arms requestAnimationFrame(draw) on every frame, unconditionally (Waveform.tsx:126-128). draw() calls getComputedStyle(el) each frame (line 56), even when clientWidth/clientHeight are 0.
   - Fix: Pass an active/visible flag to Waveform, or have DeckView/DancerMode pass one: don't schedule frames while hidden and restart the loop when visible again. A cheaper option is to skip drawing when el.clientWidth === 0 and poll at a low rate, or use an IntersectionObserver or ResizeObserver to pause the loop.
6. **[spec] apps/web/src/dancer/dancer.css:90** (ui) — In phone portrait with a video loaded, turning on 'Edit cues' makes the Dancer panel scroll. The video uses the height the pads would need. Edit pads need 101 px each (18 px top + 48 px bottom padding + name + time + 4 px border), but with a video the pads only get 2×80–90 px.
   - Evidence: MP4 loaded, Edit cues on, .dancer-main scrollHeight vs clientHeight: 360×780 → 762 vs 731 (+31 px); 390×844 → 825 vs 795 (+30 px; the bottom pad row runs to y=862 > innerHeight 844); 430×932 → 886 vs 883 (+3 px); 390×844 with simulated 47/34 px safe-area insets → 756 vs 714 (+42 px). With Demo (no video), edit mode fits. Phone landscape already avoids this (dancer.css:143-146 hides tempo while editing).
   - Fix: Use the same approach as phone landscape: hide tempo while editing with a video in phone portrait. Add after the max-width 599px block (~line 95):
@media (max-width: 599px) {
  .dancer.has-video.editing .tempo { display: none; }
}
Tested in the browser pane: 390×844 safe-area → 714/714, pads 145 px; 360×780 → 731/731, pads 151 px. No scrolling.
7. **[spec] apps/web/src/dancer/dancer.css:377** (ui) — Phone-landscape Stage view with a video and more than 4 cues: the pads wrap 5 + 3, so the floating bar is 172 px tall. It covers 44 % of a 390 px-tall screen and hides part of the centred ▶ 'paused' badge, which is centred on the full screen (top: 50%) without allowing for the bar.
   - Evidence: 844×390, MP4 and 8 cues, Stage open: .stage-bar [12,206,820,172]; pads 100×72 at y=216 (5 pads) and y=296 (3 pads). .video-paused spans y=169–221 and the bar starts at y=206, so the bottom 15 px of the badge sits under the blurred bar (zoomed screenshot confirms). At 1180×820 and 1366×1024 the 8 pads fit one row (bar 92 px), so only phone landscape is affected.
   - Fix: Narrower pad minimum in phone landscape so up to 8 pads fit one row, plus a raised badge in landscape Stage:
@media (orientation: landscape) and (max-height: 499px) {
  .stage-pads { grid-template-columns: repeat(auto-fit, minmax(56px, 1fr)); }
}
@media (orientation: landscape) {
  .stage-has-video .video-paused { top: 30%; }
}
Tested at 844×390: bar 92 px tall (top y=286), 8 pads at 60×72 px with labels unclipped (41/41 px), badge at y=91–143, clear of the bar.
8. **[quality] apps/web/src/dancer/dancer.css:343** (ui) — Portrait Stage view with a video: the picture sits at the top and controls are pinned to the bottom, leaving a large empty black band in the middle of the screen. Nothing grows to fill it, so the screen looks unfinished.
   - Evidence: 390×844, 4 cues: video [12,64,366,206], bar top y=638, so a 368 px empty band (44 % of the screen). 360×780 with 8 cues: video ends y=253, bar starts y=454 (201 px gap). 768×1024: video ends y=483, bar starts y=698 (215 px gap). Screenshots show a black void between the picture and Play/Restart.
   - Fix: Let the screen area take the free height and centre the video in it, keeping the bar at the bottom. In the portrait block change
.stage-has-video .stage-screen { flex: 0 1 auto; display: flex; flex-direction: column; }
to
.stage-has-video .stage-screen { flex: 1 1 auto; display: flex; flex-direction: column; justify-content: center; }
Tested at 768×1024: screen [12,64,744,622], video centred at y=166–585, bar unchanged at y=698, no overflow (stage scrollHeight 1024).
9. **[quality] apps/web/src/styles.css:451** (ui) — On iPad landscape the song or video name is cut to one line with an ellipsis. The labelled 'Screen on' toggle (107 px) now shares the 402 px left-column row with Demo and Load, leaving the title 132 px. Phones (≤599 px wide or phone landscape) already wrap the title to two lines, but tablets still use the base .deck-title nowrap + ellipsis (styles.css:200-206).
   - Evidence: 1180×820 and 1366×1024 with dance-120bpm.mp4: .deck-title scrollWidth 146 > clientWidth 132, so it renders as 'dance-120bpm....' (zoomed screenshot). At 844×390 the same name shows in full on two lines.
   - Fix: Move the phone two-line clamp to the base Dancer rule so it applies at every size:
.dancer-head .deck-title { color: var(--text); font-weight: 600; font-size: 15px; line-height: 1.25; white-space: normal; overflow-wrap: anywhere; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
Then remove the duplicate properties from the phone block (styles.css:808-816) and keep only font-size: 13px there. Tested at 1180×820: title 132×38 px with no clipping (scrollWidth = clientWidth = 132), head row still 44 px, panel still not scrolling.
10. **[quality] apps/web/src/dancer/dancer.css:19** (ui) — On iPad portrait (768×1024) the video in the waveform area is very small. The tablet --video-h formula leaves the frame only 120 px tall across a 710 px-wide card, so the 16:9 picture is about 213×120 px with roughly 250 px black bars on each side. Meanwhile the pads keep 138 px rows.
   - Evidence: 768×1024, MP4 loaded: .dancer-video [29,226,710,120] (0.85×1024 − 750 = 120 px); pads 138 px each; screenshot shows a narrow picture inside a wide black strip.
   - Fix: Give the video more of the pads' spare height on tablets: --video-h: clamp(var(--wave-h), calc(var(--avail-h) * 0.85 - 680px), 45dvh);
Tested at 768×1024: video frame 710×190 (picture about 338×190); pads 103 px (above the tablet --pad-min of 96 px); .dancer-main 959/959 with no scrolling, also with Edit cues on (pads 103 px). Optionally also add align-self: center; width: min(100%, calc(var(--video-h) * var(--video-ar, 1.7778))) to .dancer-video so the frame is no wider than the picture.
11. **[quality] apps/web/src/dancer/dancer.css:358** (ui) — In portrait Stage without a video (audio songs and Demo), the cue pads stay at the 72 px minimum even though about 600 px above them shows only the cue name and time. The taller pads (up to 112 px) only apply to .stage-has-video, so audio songs get smaller performance targets than videos in the same view.
   - Evidence: 430×932, Demo with 3 cues, Stage open: .stage-now is 650 px tall and the pads are 96×72 at y=848. With a video at 360×780 and 390×844 the pads are 112 px tall.
   - Fix: Apply the taller rows to every portrait Stage. Change the portrait rule from `.stage-has-video .stage-pads { grid-auto-rows: … }` to `.stage-pads { grid-auto-rows: minmax(var(--stage-pad-h), 112px); }` inside @media (orientation: portrait). Tested at 430×932 with no video: pads 96×112 at y=808, .stage-now still 650 px, no overflow (stage scrollHeight 932).
