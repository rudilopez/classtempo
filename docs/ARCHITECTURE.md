# ClassTempo architecture

ClassTempo is a static React/TypeScript PWA for one-track dance instruction. Vite builds `apps/web/dist`,
including a generated service worker. GitHub Pages serves the app under `/mixdeck/`; relative asset paths keep
it portable to other static hosts. No account, media upload or application server is involved in current playback.

## Application and playback

`App.tsx` creates one `Engine.create({ dj: false })` and mounts the existing `DancerMode` component. The component
name is historical: it is now the only product player. Song/Video opens the corresponding file picker and sets
the library filter. Cancelling it preserves current media; no selection starts playback. The former DJ surface
is not mounted; DJ decks and their processors are not initialized. Legacy engine methods/components remain for
existing tests and can be removed separately.

Audio files are decoded once to an AudioBuffer and played by the shared `StretchDeck`. Signalsmith Stretch runs
in an AudioWorklet and preserves pitch while changing rate between 0.5 and 1.5. The audio graph is:

```text
Audio file → decode → StretchDeck → classroom gain → AudioContext destination
                       ↓
                 position updates → cues / practice / Media Session
```

The classroom gain normally uses the existing 0.9 headroom factor. Talk ramps that output to 20% of normal and
restores it afterward. It does not alter the operating system or speaker's master volume.

Video files use a `VideoDeck` backed by one native `<video playsinline>` and an object URL. `playbackRate` and
`preservesPitch` control speed where supported. Video never triggers a second whole-file audio decode for BPM
or waveform analysis. Its timeline is seekable but has no derived waveform/BPM. The element mounts during load,
reports readiness/errors, and moves into and out of Stage without replacing the media element or its playback.
Mirror and zoom are visual transforms; they do not rewrite the source file. Native-video Talk pauses and resumes
when appropriate because reliable per-element volume attenuation cannot be assumed on the target phone.

Audio analysis runs in a Worker: downmix, BPM/beat-grid estimation and overview peaks. Results apply only to the
current load. Audio decoding still has a significant memory cost; videos avoid that PCM allocation entirely.
A five-minute stereo audio buffer at 48 kHz float32 is approximately 115 MB before analysis/engine copies.

## Practice and transport

`src/practice/settings.ts` defines validated per-track settings: tempo, up to 12 named sections, the selected
section, off/once/repeat mode, repeat count, gap and start-delay seconds, video mirror and zoom. Section endpoints
are clamped to the loaded duration; invalid values are normalized before playback is scheduled.

`src/practice/controller.ts` is a position-driven state machine: idle → preparing → delay → playing → gap,
complete or error. It counts total passes including the first, supports repeat-until-stopped, and resumes a first
pass within the selected section when appropriate. Timer generations reject stale callbacks after cancellation.
The host cancels pending work on manual load/seek/cue launch/pause and teardown. Timers provide rehearsal
behavior, not sample-accurate or guaranteed background scheduling; physical-phone checks remain necessary.

Playback preparation starts synchronously inside the user's gesture before awaiting work or starting a timer.
For a newly loaded native video, the first Play is immediate to establish sound permission; a configured delay
applies to subsequent starts. A seconds-based countdown is implemented; a musical count-in is deferred.

Practice settings use `mixdeck.practice.<name>|<duration.toFixed(2)>` in localStorage. Class entries may contain
an independent validated snapshot, so two occurrences of the same song can run at different speeds. Loading a
snapshot applies it to that session without replacing the file's default merely by selecting the exercise.
Changing settings or explicitly capturing them updates the relevant saved data through the owning UI.

Cue storage remains `mixdeck.dancer.cues.<name>|<duration.toFixed(2)>`. Existing users' cues therefore survive the
product rename. Eight slots store `{ time, name }` or null. Cue creation/movement/removal/renaming requires Edit;
outside Edit, only existing cues launch. Undo stores recent cue edits for the current load. Stage is launch-only.

## Library, class sets and backups

`src/library/store.ts` uses the `classtempo-library` IndexedDB database with three stores:

| Store | Records |
|---|---|
| `media` | ID, filename, MIME type, size, modification time, media kind, added/opened timestamps, availability |
| `files` | Original File/Blob by media ID |
| `classes` | Named ordered sets, each occurrence ID referencing media plus optional practice snapshot/duration |

File and metadata writes commit in the same transaction. A successful decode is not proof of a saved local copy;
a failed save is surfaced while direct playback may remain usable. Listing metadata does not load all media
blobs. File identity uses filename, size, modification time and MIME type, avoiding a second full read/hash of
large video. It is metadata identity, not content verification. Restored placeholders can reconnect by matching
filename, size and kind when a file picker changes modification time.

Recent order uses last-opened then added time. Class advancement is manual: choosing an entry loads one item and
waits for Play. Repeated media references are supported because each occurrence has its own ID and snapshot.
Deleting a saved copy removes the Blob and leaves unavailable metadata/class references; the original external
file, cues and practice settings are retained. Deleting a class does not delete its media.

The library dialog is portalled, contains keyboard focus, marks background siblings inert and restores their
prior states on close. Phone content scrolls within the dialog; the underlying player does not grow. Dialog keys
must not trigger global player shortcuts.

Versioned JSON backups contain library descriptors, class sets, cue records and practice settings. They exclude
media Blobs. Restore validates size/schema/references and normalizes exercise snapshots; restored descriptors
are unavailable until media is imported. Existing IDs/settings are retained during merge. A partially failed
localStorage restore reports that classes may have succeeded while settings did not. Reopening the loaded track
applies restored per-track settings. Backups are user-controlled files, not cloud synchronization.

## iOS and mobile audio

- **Gesture start:** engine construction does not await `AudioContext.resume()`. `unlock()`, media Play and the
  audio keep-alive start inside the initiating gesture before asynchronous work. Rejected playback returns a
  usable retry path rather than a false playing state.
- **Audio session:** request `navigator.audioSession.type = 'playback'` before context creation where supported.
  Feature detection and exception handling preserve playback on browsers without the API.
- **Audio keep-alive:** a hidden media element plays generated silence alongside the audio deck to support the
  platform media session. Its duration follows the track, capped at 20 minutes; ordinary tracks are not looped.
  Position/rate follow the real player. Native video uses its own media element and never starts this audio path.
- **Media Session:** exposes title, current/next cue, Play/Pause, Stop and seek. Previous/Next navigate cues;
  Previous restarts an active practice section. These commands never silently advance the class set. Position
  state follows the current rate. Unsupported actions are caught; stale handlers are cleared.
- **Interruptions:** `watchAudioContext` observes context state and visibility. When playback should be running it
  attempts recovery; if another gesture is needed, a Tap to resume audio overlay is placed within the current
  fullscreen root so Stage cannot hide it.
- **Keep awake:** Screen Wake Lock is optional and feature-detected. The UI reflects the lock actually held;
  refusal, visibility changes and power-saving behavior may release it. It prevents display sleep while visible,
  not operating-system suspension or an unlimited background timer budget.
- **Phone acceptance:** lock-screen scrubbing while playing, Pause/Play, native video, delayed starts, repeated
  sections, Bluetooth output and interruptions require actual-device testing. Paused scrubbing remains a known
  WebKit limitation. A desktop WebKit run is not physical iPhone proof.

## Layout and storage lifetime

The root uses `100dvh` with a `100vh` fallback and safe-area insets. Phone portrait fits the main player without
vertical scrolling; landscape/tablet layouts use available columns. Buttons retain at least 44 px touch targets.
Cue sizes depend on the view, with compact Stage controls. The header shares space between brand, Song/Video,
Library and Keep awake. Titles live inside the media panel; the logo replaces the O in Now Playing.

The production service worker caches normal app assets, worklets and WASM. Updates install in the background
without forcibly reloading an active class. Registration checks again after returning to the foreground, with
an hourly throttle. Development unregisters an old preview worker to avoid stale source modules.

Offline playback needs both cached app assets and successfully stored local media. `navigator.storage.persist()`
is requested where supported, but the browser can still clear/evict data and the user can delete site storage.
Safari tabs and Home Screen installations may have separate storage. Never infer file availability from an app
shell cache or a settings backup alone.

## Build boundaries and deferred integrations

Signalsmith source is stringified into its worklet. Keep it excluded from Vite pre-bundling and preserve ES2022
class syntax; transpiled helper references can make worklet startup fail. Production uses no threaded WASM or
SharedArrayBuffer requirement. The dev server has COOP/COEP headers; Pages does not provide equivalent custom
headers, and future cross-origin-isolated work must account for that difference.

MusicKit and Spotify are not loaded or authenticated. See [Apple Music feasibility](APPLE_MUSIC_FEASIBILITY.md)
for credential and device-test gates. The hidden stems page lazy-loads the ONNX runtime; normal playback does not
precache that large runtime or its 166 MB model. The exact weights are research-restricted; production permission,
phone performance and an owner decision remain separate gates. No server separation fallback is authorized.

Tests cover pure data normalization, class ordering/backups, transport cancellation/repetition, engine creation,
platform helpers and existing analysis. Release verification also needs responsive browser flows, actual saved
file reloads and a separately recorded physical-device result. Passing typecheck/build is not playback acceptance.
