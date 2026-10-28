# ClassTempo — music and video for dance classes

ClassTempo is the working name for a **phone-first dance teaching player**. Load one song or video, find the
right phrase, adjust its speed, and repeat an exercise. It runs as an installable web app on iPhone, iPad and
Android, with desktop browsers supported for preparation. The GitHub repository and hosting path are now
`classtempo`; existing package names and storage keys retain `mixdeck` for compatibility.

**App:** https://rudilopez.github.io/classtempo/

**Visual user guide:** https://rudilopez.github.io/classtempo/guide.html — also available in **Library → User guide**.
Simple instructions, real app screenshots, topic search cover playback, cues, practices,
classes, Stage, stems, offline use and backups. The guide opens in a separate tab to preserve the player session.

## Classroom workflow

1. Tap **Open** to choose an ordinary song or video file. The app recognizes its type automatically; cancelling
   the picker keeps the current track. Nothing starts until Play.
2. Open **Library → Media** for all saved songs and videos together, with clear type labels and a local search.
   **Add media** saves your selection and opens it automatically, paused. With multiple files, all are saved and
   the first opens. **Classes** holds your teaching plans. **Edit class** adds full songs/videos or saved named
   practices, with optional exercise names and notes. **Teach class** keeps the running order in the player;
   use **Next & play** to move on and **Again** to restart the current exercise.
3. Adjust speed between **50% and 150%**, preserving pitch where the playback engine/browser supports it.
   The percentage sits between the minus and plus controls; **100%** restores original speed. In video Stage,
   open **Tools** for speed, Restart, Talk, Mirror and Fit/zoom.
4. Open **Practice**, enter a **Practice name**, and choose a start cue/time and an end cue/time. **Save practice**
   keeps its range, tempo, repeats, gap, delay and video settings with this track; **Start practice** saves and
   starts it. Use **+ New practice** to save another, or **Saved practices** to reopen one. Repeat until stopped
   is the default. The player shows the active name and pass progress. **End practice**, available in the player,
   editor and Stage, pauses at the current position and returns to normal Play without deleting saved practices.
   Tap Play to continue the full track at the current tempo, without the practice delay. ✕ discards unsaved edits.
5. Select **Cues** in the **Cues / Stems** header. Tap an **empty cue pad** to save the current position immediately, even while playing. Tap a saved cue to
   play from it. **Edit cues** moves, renames or clears existing cues; Undo restores recent changes. Launching a
   cue inside the active practice range keeps repeating; a cue outside it switches to full-track playback with
   visible feedback. **Stems → Prepare stems** separates a local song into Vocal, Instruments, Bass and Drums.
   Preparation is optional; the first run downloads about 80 MB of model weights plus the runtime. Tap **Use stems**,
   mute parts, or choose **Acapella**, **Instrumental** or **All**. **Original** returns to the original recording
   at the current position. Low/High drums focus frequency ranges, rather than isolating a kick or hi-hat.
   Stems preparation accepts songs up to **4:30** and 100 MB; ordinary song/video playback has no duration cap.
   Preparing and playing stems use extra memory. Low-memory devices may stop playback or close ClassTempo;
   prepare before class and close unused apps. These limits reduce memory pressure but cannot prevent every crash.
   Keep the app visible while preparing; songs stay on the device. Saved stems reopen without separating
   again. Video and subscription streams are not supported.
6. The regular player keeps its picture, tempo and cue pads visible together. Tap **Stage** to make video large,
   above a compact **Play · Cues · Practice · Tools · Exit** bar and seek line. In Stage, **Cues** opens one
   horizontally scrollable row of numbered buttons below the picture. Tap an empty number to save a cue, or a
   saved number to play from it. Tools also opens below the picture. Close either panel to give that space back
   to the video. Full-picture Fit stays the default, and **End practice** stays reachable.

Full songs/videos added to a class start at 100%, without a repeat or delay inherited from earlier practice.
Adding a saved named practice copies its range, tempo, repeats, gap, delay and video settings into that exercise.
The same file can appear several times with different settings. In **Edit class**, open an exercise's details
to rename it, add a teaching note or explicitly **Use current player settings**, then **Save class**. These
changes do not silently overwrite the song's saved practice. Cues remain shared per file.

The class strip shows your current exercise and what comes next. Open its **Running order** to jump to an
exercise paused, go to the previous exercise or exit the class. **Auto-next** is off by default. When enabled,
it advances after a full track or the final pass of a finite practice; a practice repeating until stopped
stays put until you choose Next. Missing files and playback errors stop progression. Before teaching, the app
checks access to the actual saved files; that check does not guarantee every video codec will play.
Returning to saved class progress opens paused, without restarting a delay or music. Class controls remain
below the picture in video Stage.

**Talk** lowers audio to 20% of its normal app level and restores it when tapped again. For native video it
pauses instead, then resumes if the video had been playing. **Keep awake** prevents automatic display sleep
while the app is visible and the browser grants the wake lock; its active state reflects the lock actually held.

Video opens with metadata preloading and no forced initial seek. Fatal errors offer **Retry video** and
**Copy details**; details contain playback diagnostics, never media contents or a file path.

The first video Play starts immediately to establish browser permission for sound. Start delays apply to later
video starts. The delay is measured in seconds; a beat-aligned musical count-in is not implemented.

## Music sources and privacy

The current player uses **local audio and video files**, including files selected from a cloud drive through the
system file picker. MP3, M4A/AAC, WAV, AIFF and browser-supported video formats are accepted; FLAC, OGG and other
formats depend on the browser's decoder. A file may need to finish downloading from its provider first.

**Apple Music uses the familiar ClassTempo player.** Open **Library → Apple Music**, connect your subscription,
then search the catalog or browse My songs and Playlists. Selecting a song closes the picker and opens the song
paused, with the same branding, Now Playing, Play/Pause, Restart and Stage layout. The Apple Music source uses
Apple's streaming player underneath; imported songs and videos keep their existing local engine.
**Open** still accepts a local song or video directly from this player. **Library → Files & classes** returns
to saved local media. Switching sources pauses the source you leave; returning does not restart an old delay
or class transition.

Apple Music cues work like local-file cues: tap an empty pad to save the current position, or tap a saved cue
to **play from that point**. Music keeps playing when you jump; from pause, the cue starts playback. There is
no extra Play step. Edit cues moves, renames or clears cues, with Undo for changes. Talk pauses streaming and
resumes only if it was playing when Talk began. Streaming cues use provider IDs and do not replace cues saved
for local files.

Apple Music plays at **original speed only** and requires internet and an active subscription. Saved local
classes, named practices, pitch-preserving tempo changes and stems continue to use imported files. Subscription
downloads are not ordinary files ClassTempo can import or save offline. The owner approved bringing streaming
into the same player first; clean streaming tempo remains a separate investigation. Spotify is not integrated.

The earlier connection screen's production Chrome authorization, catalog/library browsing, paused selection,
Play/Pause, seeking and teardown were verified on 2026-10-28. The owner confirmed clear audio at 100%, with
playback observed beyond the preview range. Slower playback warbled and faster playback changed pitch, so those
speed controls were removed. Uninterrupted full-track completion and physical-iPhone acceptance remain
unverified; the shared interface does not establish them. See the
[setup instructions](docs/APPLE_MUSIC_SETUP.md) and [feasibility plan](docs/APPLE_MUSIC_FEASIBILITY.md).

Local media and settings stay on this device; there is no local-media upload service or cloud sync. The optional
Apple Music source uses Apple's SDK, authorization and network services; it does not upload imported media. The supplied white
logo forms the O in Now Playing and the final o in the larger ClassTempo wordmark. The former DJ interface and synthetic Demo have been removed from the product.

## Saved files, backups and offline use

Successful imports save a local media copy in IndexedDB. Library failures are reported: the player may still
open a file directly, but a failed save does not make it available offline. Removing a saved copy leaves the
original file and class entries intact; reimport the original to reconnect the entry.

Library → **Backup & device storage** exports class sets, exercise names/notes, per-exercise settings, cues and per-track practice
settings as JSON. **The backup does not contain songs or videos.** Keep the originals separately. Restore adds
missing items without overwriting existing settings, then import missing media and reload the current track.
Apple Music cue bookmarks currently stay in this browser and are not included in that local-media backup.

After a successful online launch of the installed app, the app shell is cached. Saved media can then play
without a connection while those files and caches remain on the device. Browsers can evict storage, and clearing
site data deletes local files/settings. The app requests persistent storage where supported, but this is not a
guarantee. Safari and the Home Screen installation may have separate storage; prepare and use the same installation.

## Install and use on a phone

- **iPhone/iPad:** open the link in Safari → Share → Add to Home Screen. Launch the installed app once online.
- **Android:** open the link in Chrome and choose Install app or Add to Home screen when offered.
- Start playback before locking the screen. Lock-screen/headphone controls provide Play/Pause, seek and cue
  navigation where supported. Previous restarts an active practice section; Next navigates cues, not class songs.
- Calls, voice assistants and other apps may interrupt playback. If the browser requires another gesture,
  **Tap to resume audio** appears. Bluetooth speaker latency is outside the app's timing control.
- Updates download while online and take effect on a subsequent launch; the app never reloads an ongoing class
  automatically. Close and reopen the app after an online launch if an older interface remains visible.

**Physical iPhone checks remain required:** lock-screen scrubbing, interruption recovery, practice delays and
repeats in the background, the reported 31-second 4K H.264 video, and Stage transitions. Desktop browser tests do
not establish real-phone acceptance. The owner confirmed that the supplied 1080p copy plays on the iPhone;
this does not establish support for the original 4K file. Paused lock-screen scrubbing remains a known WebKit limitation.

## Development

```bash
npm install
npm run dev
npm run typecheck
npm test
npm run build
```

Vite serves development on `http://localhost:5173`. `npm run preview` serves the production build, including its
service worker, on the same port. Production output is `apps/web/dist`; a push to `main` runs GitHub Actions
checks and deploys to Pages. Work on a branch and verify the deployed workflow separately from local checks.

AudioWorklet and installation require HTTPS, except on localhost. Signalsmith Stretch is excluded from Vite
pre-bundling and uses an ES2022 build target so its stringified worklet source remains valid. Do not lower that
target without testing the actual worklet startup.

| Location | Purpose |
|---|---|
| `apps/web/src/dancer` | Single audio/video player, cues and Stage |
| `apps/web/src/practice` | Saved practice settings, section controller and editor |
| `apps/web/src/library` | IndexedDB files, recents, class sets and backup UI |
| `apps/web/src/platform` | Audio recovery, wake lock, keep-alive and Media Session |
| `packages/engine` | Shared context, Signalsmith audio player and native video player |
| `packages/analysis` | Audio BPM, beat grid and waveform analysis |

The production app creates `Engine.create({ dj: false })`; it does not initialize DJ decks or their worklet
processors. Some legacy mixer components and package scaffolds remain in the repository but are not product UI.

The [local stems feature](docs/STEMS_MODEL.md) uses Spleeter weights with explicit upstream licensing,
independently of the historical [HTDemucs benchmark](https://rudilopez.github.io/mixdeck/#stems-benchmark).
It saves separated PCM in a separate 500 MiB cache, evicting least-recently-used stem results without removing
original songs or classes. **Saved stems & details** offers removal for the current song. Browser storage can
still be cleared or evicted. Stems are not included in settings backups. On 2026-10-23, the owner confirmed
preparation of the supplied song and clear All-at-100% playback on the physical iPhone, completing the gate
for removing Beta. Preparation speed, other songs/devices, isolated-stem quality and changed-tempo listening
are not covered by that confirmation; no server fallback is enabled.

Further detail: [architecture](docs/ARCHITECTURE.md), [delivery plan](docs/BUILD_PLAN.md),
[product scope](docs/VISION_AND_PARITY.md), [historical handoff](docs/HANDOFF.md),
[stems research](docs/STEMS_BENCHMARK.md).
