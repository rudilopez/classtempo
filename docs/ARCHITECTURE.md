# ClassTempo architecture

ClassTempo is a static React/TypeScript PWA for one-track dance instruction. Vite builds `apps/web/dist`,
including a generated service worker. GitHub Pages serves the app under `/mixdeck/`; relative asset paths keep
it portable to other static hosts. No account, media upload or application server is involved in current playback.

## Application and playback

`App.tsx` creates one `Engine.create({ dj: false })` and mounts the existing `DancerMode` component. The component
name is historical: it is now the only product player. Open accepts either audio or video and the actual file
type selects the playback engine. Cancelling it preserves current media; no selection starts playback. The former DJ surface
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
It requests metadata preloading and starts at zero without a URL time fragment or forced initial seek. Error
recovery retries the same in-memory file paused. Already saved files are not written again; a first Open that
failed before metadata retains its original save intent and saves only after successful recovery. A bounded 32-event diagnostic
snapshot contains media dimensions/state/error and file size/type, omitting filenames, URLs and media bytes;
copying it is an explicit user action.
A fatal native decoder error latches a paused/unavailable state until a fresh load; late play events cannot
reactivate it. The readable recovery message replaces the picture controls in both player views.
Mirror and zoom are visual transforms; they do not rewrite the source file. Native-video Talk pauses and resumes
when appropriate because reliable per-element volume attenuation cannot be assumed on the target phone.

Audio analysis runs in a Worker: downmix, BPM/beat-grid estimation and overview peaks. Results apply only to the
current load. Audio decoding still has a significant memory cost; videos avoid that PCM allocation entirely.
A five-minute stereo audio buffer at 48 kHz float32 is approximately 115 MB before analysis/engine copies.

## Practice and transport

Practice edits a local draft. Cue selectors populate exact start/end times; `draft.ts` validates and commits the
visible range when Start practice or Save practice is chosen. Start invokes the host synchronously within the
user gesture and seeks to A; Save closes paused. ✕/Escape discard the draft. The main Practice button retains a
stable label with the active saved name, and the transport shows Repeat/Section plus pass/completion status.
The player, editor and Stage expose End practice. It cancels pending passes, pauses at the current position,
clears Talk and the active delay, and sets mode off while preserving tempo, selection and every saved preset.
Normal Play then continues through the full track. A failed settings save is reported rather than overwritten
by a success toast.

`src/practice/settings.ts` defines validated per-track settings: tempo, up to 12 named sections, the selected
section, off/once/repeat mode, repeat count, gap and start-delay seconds, video mirror and zoom. Section endpoints
are clamped to the loaded duration; invalid values are normalized before playback is scheduled. Each section
may contain a `playback` snapshot of tempo, once/repeat, total passes, gap, delay, mirror and zoom. Explicitly
choosing a saved practice restores its snapshot; normalizing storage never activates one automatically. Older
range-only sections retain their IDs/names and use the current options until saved. New practice creates an
independent preset; saving an existing one updates only that preset. Storage keys and class/backup formats remain
compatible, and nested snapshots are validated on import.

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
product rename. Eight slots store `{ time, name }` or null. An empty pad sets a cue immediately without changing
playback; editing an existing position/name or clearing it requires Edit. Undo is available after a one-tap
creation as well. A cue launch within an active practice range starts a new run at that cue without disabling
its mode; launches outside the range explicitly switch to full track. Video Stage can set empty slots from
its numbered strip and launch saved cues; audio Stage retains its launch-only pads.

## Library, class sets and backups

The dialog opens to **Media**, a single recent-first list of saved songs and videos with explicit type badges.
**Classes** starts with a named-card overview; selecting a card opens its ordered exercises. Search appears only
when media exists, filters saved filenames without case/accent sensitivity, and reports counts or a clear empty
result. It is not a music-service search. Backup utilities are collapsed below the current view.

Open in the player directly selects one file. Add media in the library saves the whole selection, then opens the
first selected item paused and closes the dialog. `importFlow.ts` separates save and open outcomes: a null library
ID tells the player that saving failed and prevents an automatic retry, while the user gets explicit unsaved
feedback. Cancelling is a no-op. Save current only persists the file and preserves playback/practice. Updating
recency cannot turn a successful load into a reported failure.

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
Cue sizes depend on the view, with compact Stage controls. The header shares space between the larger ClassTempo wordmark, Open,
Library and Keep awake. Titles live inside the media panel; the palm logo replaces the O in Now Playing and the
final o in ClassTempo.

The regular player retains its picture, full cue pads and tempo controls. Its Cues/Stems pill switches only
the pad area. Selecting Stems exits cue editing while preserving cue history, track and practice settings;
it never starts a model download. Prepare explicitly starts a cancellable Spleeter Worker, with pinned size
and SHA-256 checks for each model. The models and inference runtime are excluded from normal app precaching.

The four stereo stems use one lazily created eight-channel Signalsmith transport (`StemDeck`) so tempo,
seeks and cues remain synchronized. A splitter restores stereo pairs, per-stem ramped gains feed a stereo
mix and the existing classroom Talk gain. Low/High drums replace the drum route with a low/high-pass filter.
The original stereo deck remains loaded for immediate source switching at the same position; pending
practice gaps/delays follow the shared current-player commands. Changing media cancels jobs and releases PCM.

Separated audio is saved as scaled PCM16 in `classtempo-stems`, separate from library originals and classes.
SHA-256 source contents plus model/format versions identify cache entries. Atomic writes and a 500 MiB LRU
cap preserve complete sets; save failures keep session playback available but explicitly unsaved. Model
cache and saved-stem eviction are independent. See [STEMS_MODEL.md](STEMS_MODEL.md) for signal and license details.

Video Stage uses a flexing picture, 44 px seek target and 48 px dock for Play, Cues, Practice, Tools and Exit.
Cues opens a horizontal strip of 44 px numbered buttons below the picture, including empty slots that set a cue
when tapped. Tools also sits below the picture; neither panel obscures it. Short landscape combines seeking and
the dock in one row. The active practice name and End action remain reachable. Panel toggles do not remount the
native video; keyboard events on controls do not trigger global playback shortcuts. Audio Stage remains separate.

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
for credential and device-test gates. The hidden historical Demucs page retains its research-only model; the
production stems beta uses a separate licensed Spleeter model. Neither runtime nor model downloads occur during
normal playback. Physical phone preparation/playback validation remains separate. No server fallback is enabled.

Tests cover pure data normalization, class ordering/backups, transport cancellation/repetition, engine creation,
platform helpers and existing analysis. Release verification also needs responsive browser flows, actual saved
file reloads and a separately recorded physical-device result. Passing typecheck/build is not playback acceptance.
