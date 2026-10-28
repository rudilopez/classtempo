# ClassTempo architecture

ClassTempo is a static React/TypeScript PWA for one-track dance instruction. Vite builds `apps/web/dist`,
including a generated service worker. GitHub Pages serves the app under `/classtempo/`; relative asset paths keep
it portable to other static hosts. No account, media upload or application server is involved in local-file playback.

## Apple Music in the shared player presentation

The owner approved a familiar ClassTempo player for Apple Music at normal speed first, with clean streaming
tempo research next. The `#apple-music` source keeps provider playback separate internally while sharing player
branding, Now Playing, transport and Stage presentation. Search, library songs and playlists live in a picker
that closes after a paused song selection. Switching sources must silence the old source and cancel its pending
work; matching the visual controls does not make streaming a local File.

`main.tsx` changes between local and Apple Music sources without reloading the document. Once opened, the local
`App` remains mounted but hidden and inactive during streaming, preserving its loaded file while cancelling
practice/class transitions, closing its dialogs and releasing Keep awake. Apple Music unmounts and stops its
SDK transport when leaving. A selected File can be handed directly to the local player in memory; the local
deck loads it once ready, without another file-picker step. Playback info also offers an explicit clean
Apple Music restart when the local engine exists. It stores validated song metadata only in a five-minute,
one-shot sessionStorage handoff, replaces the route and reloads the document. The fresh Apple-only setup
consumes the handoff after its disposal guard, queues the same song paused at 100% and restores saved cues.
No playback starts automatically. This diagnostic restart discards the in-memory local deck; library files
and persisted settings remain. If temporary storage is unavailable, the action fails without reloading. The historical stems benchmark still reloads into
a fresh document for isolated memory measurements.

Normal local-player startup does not load MusicKit. The Apple Music source fetches public
`apple-music-config.json` with no cache; the service worker neither precaches nor intercepts that endpoint.
The Library entry requires the configured build flag. No credentials means no entry.

The deployment runner signs an origin-restricted, 30-day developer JWT using Node crypto and three repository
secrets. The private key never enters Vite environment variables or assets. A weekly deployment refreshes the
token; stale/expired setup is reported, never silently treated as available. MusicKit owns user authorization and
protected media playback. The source's read-only lists are first-page/25-item views. Songs queue paused and start
only from a tap; SDK events/progress drive the display. Generation guards discard stale account/list results,
and SDK configure/queue operations cannot overlap retries while their underlying promises remain pending.
Apple Music initializes and selects songs paused at original speed. The regular player reuses `TempoControl`
for 50–150% in whole-percent steps, ±1% nudges and the 50/75/90/100/110% presets. No query parameter is needed.
Play reaches the SDK synchronously within the user gesture and preserves the requested rate, including after
its asynchronous completion; seeking also preserves rate and playback state. Selecting 100% changes speed
without pausing, starting or losing a prepared cue offset. The Playback info button opens read-only
pitch/rate/timing/buffer diagnostics; those readings do not establish audible quality. Configuration requests
MusicKit HIGH (256 kbps) before any queue is loaded. This is a source-quality target, not measured bitrate or
a different time-stretch algorithm. A bounded read-only event history helps distinguish waiting for data from
steady playback artifacts. Passive local-context bookkeeping distinguishes a fresh Apple-only page from one
that previously opened the local player; it never creates, starts, suspends or routes an audio context.
Back 10s, Talk, Play/Pause, Restart and seeking remain available in the familiar layout.
No provider samples enter the local engine, stems, IndexedDB media store, class plans or backup format.
Streaming cues use `classtempo.apple-music.cues.<type>.<encoded provider ID>`; filename/duration local cue keys
remain unchanged. These bookmarks store only positions/names and are not part of the local-file backup.
MusicKit seeks are asynchronous. The transport refuses overlapping seeks and keeps its native-operation lock
until the underlying promise settles, even if the adapter is disposed. A saved cue preserves playback state,
matching local cues in the player and Stage: it keeps music playing, or stays paused at the cue until Play.
A freshly queued, uninitialized stream must also accept a cue without starting audio. Pause, source changes,
authorization loss and teardown must invalidate pending cue work so a late SDK completion cannot restart it.
Talk uses pause/resume for streaming rather than the local audio gain node. Streaming practice repeats and local class integration are not enabled by
reusing the same presentation.

Apple account activation, MusicKit identifier/key creation and repository-secret setup were completed on
2026-10-28. The earlier connection screen verified production Chrome subscriber authorization, read-only
catalog/library access, paused selection, Play/Pause, seeking and return-to-local teardown. The owner confirmed
clear audio at 100%, with playback observed beyond the
preview range. An earlier listening test found warbling at slower speed and pitch changes at faster speed.
After the slider and presets returned, the owner confirmed on 2026-10-28 that all tempos sounded great on Mac.
The subsequent iPhone listening check failed at 75% despite matching requested/SDK/native rates and enabled
pitch preservation. Public MusicKit offers a stream-bitrate target but no pitch-correction algorithm selector. Other iPhone rates, iPad/Android
listening and uninterrupted full-track completion remain outstanding. See
[APPLE_MUSIC_SETUP.md](APPLE_MUSIC_SETUP.md) and [APPLE_MUSIC_FEASIBILITY.md](APPLE_MUSIC_FEASIBILITY.md).

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
snapshot applies it to that session without replacing the file's default. A class occurrence without a snapshot
uses fresh practice defaults: full file, 100% tempo, no repeat or delay. Ordinary Media loading retains the saved
track behavior. Named-practice additions activate that section's saved playback options and copy a normalized
snapshot. Class settings change only through explicit editing/capture; session selection never rewrites them.

Cue storage remains `mixdeck.dancer.cues.<name>|<duration.toFixed(2)>`. Existing users' cues therefore survive the
product rename. Eight slots store `{ time, name }` or null. An empty pad sets a cue immediately without changing
playback; editing an existing position/name or clearing it requires Edit. Undo is available after a one-tap
creation as well. A saved cue keeps the current playing/paused state. Within an active practice range it
preserves the mode and continues the run from the cue only when already playing; while paused it only moves
the position. Cues outside the range explicitly switch to full track without starting a paused track. Video
Stage can set empty slots from its numbered strip and select saved cues; audio Stage shows saved-cue pads.

## Library, class sets and backups

The dialog opens to **Media**, a single recent-first list of saved songs and videos with explicit type badges.
**Classes** starts with a named-card overview; selecting a card opens its ordered exercises with Teach class and
Edit class actions. Edits are local drafts until Save class. Search appears only
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
| `classes` | Named ordered sets with optional Auto-next; occurrence IDs reference media plus optional name, note and practice snapshot/duration |

File and metadata writes commit in the same transaction. A successful decode is not proof of a saved local copy;
a failed save is surfaced while direct playback may remain usable. Listing metadata does not load all media
blobs. File identity uses filename, size, modification time and MIME type, avoiding a second full read/hash of
large video. It is metadata identity, not content verification. Restored placeholders can reconnect by matching
filename, size and kind when a file picker changes modification time.

Recent order uses last-opened then added time. `library/classPreparation.ts` discovers saved named practices for
all saved media through the existing filename/duration keys, without decoding or opening those files. Each
addition gets an independently normalized snapshot; full-file additions need no configuration. Repeated media
references are supported because each occurrence has its own ID and snapshot.

Teach class enters a live session in the existing player. `classes/ClassControls.tsx` shows the current step,
next exercise and Next & play; its running order selects an exercise paused, moves to the previous one, toggles
Auto-next or exits. Again restarts the current exercise. Video Stage keeps these controls below the picture.
Auto-next defaults off and is an explicit class/session setting. With it enabled, advancement follows either
the full-file end or the final finite practice pass. Endless repeat does not complete or advance on its own.
Manual changes, cancellation, new loads and errors invalidate pending advancement; missing or failed files
are never silently skipped. Browser-blocked video playback requires another explicit Play action.

`classes/session.ts` preflights each distinct saved File by retrieving it and reading a byte, rather than trusting
metadata availability. It checks sequentially without decoding or retaining every song, supports cancellation,
and reports affected occurrences together. This proves current file access, not codec compatibility or permanent
offline availability. A versioned localStorage resume record stores only class/entry identity, position,
Auto-next and completion state. Restoring validates those references and the actual track duration, loads paused,
and never revives a countdown or starts music. Exit preserves the paused resume location; finishing marks that
session complete. Neither action deletes the saved class.

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
Apple browsers and browsers without WebGPU use a separate plain-WASM worker; other GPU-capable browsers use
JSEP. A failed GPU initialization/inference transfers input back for retry in a fresh CPU-only worker, avoiding
the runtime's sticky initialization failure. Cancellation terminates whichever worker currently owns the input.
Failure details preserve the original cause and runtime/version without media contents or filenames.
The plain runtime's checked build adapter caps its WASM maximum and growth ceiling at 256 MiB (upstream: 4 GiB).
It verifies the pinned 1.30.0 source hash and fails the build on drift or bypass; GPU bundles and installed
dependencies are unchanged. Reports include the configured maximum and observed heap. Models are read and
hash-verified one at a time, with session teardown between runs; only failed cache writes retain weights for
the current job. Stems preparation alone has a 4:30/100 MB limit; ordinary media playback remains unrestricted.

After original model integrity checks, `modelPrecision.ts` derives an FP32-compute graph for WASM. The pinned
FP16 weight bytes remain unchanged; weight Cast nodes and FP32 intermediates prevent half-precision activation
overflow without changing stereo, context, gain or operators. Its strict graph contract uses the protobuf
schema bundled inside pinned ORT 1.30.0; dependency upgrades must revalidate that private import and adapter.
Each model output is checked immediately, so numeric errors identify the actual stem and also trigger fresh
CPU recovery from WebGPU. Reports distinguish compute version/precision from the model/cache format version.
Existing finite saved stems keep their cache key; this correction does not force accepted results to regenerate.

The four stereo stems use one lazily created eight-channel transport (`StemDeck`) so tempo,
seeks and cues remain synchronized. An opt-in, checked Signalsmith wrapper adapter plays the already-owned
PCM directly at unity tempo/zero pitch and returns silence when paused, avoiding phase processing and its
CPU cost at normal speed. Scheduled changes keep the same transport latency; other tempos use the existing
Signalsmith algorithm. The ordinary stereo player does not opt in. The adapter changes no model, cached
audio or installed dependency, and adds no full-song PCM copy. A splitter restores stereo pairs, per-stem ramped gains feed a stereo
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

`public/guide.html` is a standalone instructional page, linked from Library in a new tab. Its local stylesheet,
topic search and screenshot dialog do not load the React app or audio engine. The worker precaches guide text,
styles, script and logo; screenshots are excluded from startup downloads and cached on first view. Offline
navigation resolves the guide's own cached HTML before falling back to the app shell. Screenshot changes also
version the cache, and new releases fetch current images before falling back to older offline copies.

Offline playback needs both cached app assets and successfully stored local media. `navigator.storage.persist()`
is requested where supported, but the browser can still clear/evict data and the user can delete site storage.
Safari tabs and Home Screen installations may have separate storage. Never infer file availability from an app
shell cache or a settings backup alone.

## Build boundaries and deferred integrations

Signalsmith source is stringified into its worklet. Keep it excluded from Vite pre-bundling and preserve ES2022
class syntax; transpiled helper references can make worklet startup fail. Production uses no threaded WASM or
SharedArrayBuffer requirement. The dev server has COOP/COEP headers; Pages does not provide equivalent custom
headers, and future cross-origin-isolated work must account for that difference.

MusicKit loads only after opening the optional Apple Music source. It uses the shared player presentation,
starting at original speed with visible tempo controls. Bounded Chrome authorization/playback evidence and
the owner's Mac acceptance and subsequent iPhone 75% listening failure are recorded above. Other iPhone rates,
iPad/Android listening and uninterrupted full-track completion remain outstanding.
Spotify is not integrated. See [Apple Music feasibility](APPLE_MUSIC_FEASIBILITY.md) for the remaining tests.
The hidden historical Demucs page retains its research-only model; the
production stems feature uses a separate licensed Spleeter model. Neither runtime nor model downloads occur during
normal playback. Physical phone preparation/playback validation remains separate. No server fallback is enabled.

Tests cover pure data normalization, class ordering/backups, transport cancellation/repetition, engine creation,
platform helpers and existing analysis. Release verification also needs responsive browser flows, actual saved
file reloads and a separately recorded physical-device result. Passing typecheck/build is not playback acceptance.
