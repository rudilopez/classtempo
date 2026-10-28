# Apple Music feasibility — ClassTempo

Status, 2026-10-28: **Mac tempo listening accepted; physical iPhone/iPad/Android listening and uninterrupted full-track completion outstanding**.
The signed-in Developer website confirmed active membership. The MusicKit-only Media ID
`media.io.github.rudilopez.classtempo` and an associated Media Services key were created. All three signing
credentials are stored as GitHub Actions repository secrets. The configured Pages deployment succeeded;
Apple's catalog API accepted the developer token. Production Chrome subscriber authorization, read-only
catalog/library browsing, paused selection, Play/Pause, seeking and return-to-local teardown were verified. The owner confirmed clear
audio at 100%, with playback observed beyond the preview range. Slower playback warbled and faster playback
changed pitch in the earlier experiment. After the slider and presets returned, the owner confirmed on
2026-10-28 that all tempos sounded great on Mac. **Playback info** retains read-only diagnostics. Songs still
open paused at 100%. Physical iPhone/iPad/Android listening and uninterrupted full-track completion remain
unverified. Detailed evidence is recorded below.
The owner then approved bringing normal-speed streaming into the familiar ClassTempo player first, with clean
tempo investigation next. Imported files keep their existing engine and full local teaching features.

## What is established

- Apple documents authorized catalog/library playback in apps and websites through [MusicKit](https://developer.apple.com/musickit/).
- Apple's native MusicKit provides a [playbackRate property](https://developer.apple.com/documentation/musickit/musicplayer/state-swift.class/playbackrate).
- MusicKit Web v3 also documents writable `playbackRate`, forwarded to the browser media element, and
  `seekToTime(seconds)`. This establishes an API surface, not preserved pitch or reliable iPhone repetition.
  See the [web instance reference](https://js-cdn.music.apple.com/musickit/v3/docs/index.html?path=/story/reference-javascript-musickit-instance--page).
- The native iPhone app [Grooves](https://apps.apple.com/us/app/grooves-song-speed-changer/id592398757) advertises Apple Music tempo changes with pitch preserved and section repetition. This is evidence of a native path, not proof of equivalent behavior in Safari or this PWA.
- The current local audio engine receives decoded file samples. Streaming playback must use its authorized provider player; do not assume stream access to decoded samples, waveform/BPM analysis, stems, or provider downloads.

## Account and credentials

The Apple account, MusicKit identifier/key and repository secrets are configured as of 2026-10-28.
The deployment signer creates the developer token according to [Apple's instructions](https://developer.apple.com/documentation/applemusicapi/generating-developer-tokens).
Never commit the signing private key or a user's music token. The build signer uses repository secrets,
30-day ES256 developer tokens restricted to `https://rudilopez.github.io`, and a weekly Pages refresh. Public
configuration bypasses the service worker cache. See [APPLE_MUSIC_SETUP.md](APPLE_MUSIC_SETUP.md).

## Shared player release

The owner explicitly rejected a separate connection-test experience: Apple Music should use the same player
or one that looks identical. The approved first release used original-speed streaming with the familiar
ClassTempo header, Now Playing, transport and Stage. Browsing is a picker that closes when a song is selected.
The provider player remains separate internally from local file decoding; source switches must prevent overlap.

A configured build exposes **Library → Apple Music**. Without credentials, that entry is absent and the
direct `#apple-music` route explains the missing setup. Apple's SDK loads only after valid config arrives.
Connect invokes `authorize()` directly in a tap; cancellation is not treated as authorization. Catalog search,
library songs, playlists and playlist tracks are read-only and limited visibly to their first 25 items. Selecting
a song queues it paused; only an explicit Play starts it. No local file identity, practice or class record is
created for the stream. Disconnect clears visible account lists; stale requests cannot restore them.

Play/Pause, Restart and seeking use MusicKit directly. Initialization and song selection reset to 100%.
The ordinary player shows the shared 50–150% slider, ±1% nudges and 50/75/90/100/110% presets. Play and seeks
preserve the requested rate; choosing 100% preserves playing/paused state and prepared cue position.
The Playback info button opens read-only rate, pitch and timing diagnostics.
These visible controls supersede the earlier hidden-link experiment. The implementation uses supported SDK
controls, without patching a private player or extracting protected streaming samples. Phrase repetition,
native speaker routing and integration into local class sets are not implemented. Streaming cue bookmarks must
use provider identity; they must not overwrite filename-based cues for imported media. Empty pads save the
position; a saved cue jumps there while preserving playback state, matching local-file cues in the player
and Stage. A playing song keeps playing; a paused song stays paused at the cue until Play. This includes
a song whose native stream has not initialized yet. Pending cue actions must respect a later Pause, source
change or teardown. Edit cues and Undo work on the streaming
bookmarks. They stay in this browser and are not included in the local-media settings backup.
Talk pauses streaming and resumes only if it was previously playing. Keep awake and Stage reuse the existing
presentation and platform helpers. Open accepts a local file directly; Files & classes returns to the local
library. These source transitions require their own browser and device checks below.
Expired config stops streaming and requires reloading fresh configuration. Raw SDK failures and tokens are not
copied into UI diagnostics. A cancelled/stuck account attempt can be abandoned by reloading the connection.

## Bounded iPhone spike

Use the shared player with the Apple Music source and explicit authorization after verifying the configured
deployment. Tempo controls are visible in the ordinary player; unimplemented streaming practice controls stay absent.

1. Sign in, search the catalog and read the user's library/playlist without changing it.
2. Play a full subscribed track from a tap over the instructor's actual Bluetooth/AirPlay speaker connection. Record iOS version, browser versus installed PWA, SDK version, account/subscription status, and connection.
3. Confirm original-speed clarity throughout the track, including after Pause, Resume and Restart.
4. Seek beyond the preview range, use cue bookmarks and switch tracks. A song selected from Library must
   remain paused until Play is tapped. Test saved cues both while playing and paused, in the player and Stage:
   a playing song must continue from the cue; a paused song must move there and stay silent until Play. Also
   test a cue immediately after opening a song, before its first Play. Pause during a pending cue jump must
   stay paused. Test source switching: leaving Apple Music must stop the stream, and returning
   to a local file must not restart an old practice delay or class transition.
5. Lock/unlock, use headphone controls, interrupt with a call, leave/return to the app, and disconnect/reconnect the speaker. Confirm state follows actual audible playback.
6. Disable networking. Report exactly what the provider supports; do not label a subscription download as a locally cached ClassTempo file.
7. Sign out and expire/revoke the token. Confirm recoverable errors and that no stale timer starts playback.

Keep physical-iPhone acceptance separate from desktop and mock checks. Streaming tempo and phrase repetition
require supported implementation and timing plus listening tests before claiming reliable behavior or sound quality.
The owner's Mac listening acceptance does not establish the result on phone or tablet browsers. The owner explicitly
requires ClassTempo to remain web-based across phones; a native prototype or rewrite is not the intended
roadmap. Evaluate the supported browser path with physical-device listening while preserving local-file
teaching sessions and original-speed streaming as the safe default.

## Classroom use and Spotify

Technical playback and permitted classroom use are separate checks. [Apple's consumer terms](https://www.apple.com/legal/internet-services/itunes/us/terms.html) specify personal, noncommercial use. Confirm a permitted music source/arrangement for the intended commercial classes before positioning the streaming integration for that use.

[Spotify's standard developer policy](https://developer.spotify.com/policy) explicitly excludes products targeted at businesses, including dance studios; its [support guidance](https://support.spotify.com/us/article/spotify-public-commercial-use/) excludes public playback in those settings. Do not advertise Spotify classroom playback under those standard terms. No Spotify integration is shipped.

## Verified evidence and remaining checks

Activation evidence on 2026-10-28:

- [Configured Pages deployment](https://github.com/rudilopez/classtempo/actions/runs/40712530896) succeeded.
- The public configuration returned HTTP 200 with a 30-day token restricted to the production origin.
- Apple's catalog search returned HTTP 200 and a song using that developer token, without a user token.
- Production Chrome: Library entry visible, SDK initialized, listener authorization completed and the
  connected interface appeared.
- Typecheck, all 349 tests and build passed.

Bounded production Chrome playback check of the earlier connection screen on 2026-10-28:

- My songs, Playlists and the selected playlist each returned 25 items; catalog search also worked. These
  were read-only first-page checks, not a complete library audit.
- “Qué Fue Lo Que Me Hiciste” by Dalvin La Melodia queued paused at 0:00 with a displayed duration of 3:49.
  Explicit Play advanced to 0:47, and the owner confirmed clear audible playback at 100%.
- Pause held at 0:47 across several seconds. Seeking to 1:55 kept playback paused; explicit Play resumed
  there. Playback subsequently reached the track's end across the rate experiments. This establishes access
  beyond the preview range and an end transition, not uninterrupted completion of the full track.
- The removed diagnostic reported these timing samples. SDK position reporting is coarse; these are bounded
  observations, not precise rate measurements or proof of pitch preservation:

  | Requested rate | Source seconds | Wall seconds |
  | --- | ---: | ---: |
  | 100% | 11.0 | 10.2 |
  | 75% | 8.0 | 10.2 |
  | 110% | 11.0 | 10.1 |

- **Changed-speed listening failed.** The owner reported: “Audio warbles on slower and pitch changes when
  faster.” Timing response does not override that result. The original-speed setting was restored and playback
  left paused; that release enforced original speed. The later Mac acceptance below supersedes this failure
  for the owner's latest tested Mac experience.
- While the subscribed track was playing at 100%, choosing **Local player** stopped streaming and opened the
  empty, paused local player. The new page had no media elements. Reopening Apple Music through Library
  restored the authorized interface without another sign-in, with an empty, paused queue. These are Chrome
  teardown and authorization-restoration checks, not a physical-iPhone result.

Uninterrupted full-track completion, phone speaker/lock-screen behavior and the remaining device checks still
need verification. These early Chrome results are historical evidence, not physical-iPhone acceptance.
The later Mac listening pass below does not establish phone or tablet quality.
Streaming phrase repetition and integration into local classes are not implemented. Local class tools remain
independent.

Validation of the earlier original-speed update: typecheck, all 351 tests and build passed. Local checks of the real UI
with a MusicKit stub confirmed that a seeded 0.75 rate resets to 1, selection stays paused, and seeking, Back
10 seconds, Restart and Play/Pause work. Layout checks found no overflow and all buttons at least 44 pixels
high at 360×780, 390×844, 430×932, 844×390, 768×1024, 1180×820 and 1366×1024. These are local mock UI checks,
not real streaming-audio or physical-device acceptance.

Initial shared-player implementation checks on 2026-10-28 (before the cue-behavior correction):

- After the final source edits, typecheck, all 366 tests and the production build passed.
- A local MusicKit stub drove the real shared interface at 360×780, 390×844, 430×932, 844×390,
  768×1024, 1180×820 and 1366×1024. The tested player layouts had no horizontal or page overflow,
  all buttons stayed within the viewport with targets at least 44 pixels high, and cue pads were at least
  88 pixels high.
- Selecting a stub song closed the Library picker and opened it paused. A saved cue restored when the same
  provider song was opened again. Cue Rename → Save → Undo worked.
- Shared Stage made both the hidden local app and visible Apple Music app inert while open. Local audio
  Stage opened and closed correctly, with its cue and tempo controls intact.
- From the Apple Music player, Open handed the supplied M4A file directly to the local deck. The first
  selection loaded once the deck was ready, with a duration of 3:49.4 and an estimated 139.7 BPM. Local
  playback worked. Switching through Library to Apple Music paused the local song at 5.2 seconds and
  preserved the loaded song.

These pre-release checks cover the real UI and a real local audio file, with streaming simulated by the local
stub. They do not establish production streaming behavior, uninterrupted full-track completion, or
physical-iPhone acceptance. The earlier real MusicKit evidence above remains a separate result.

Historical cue corrections, 2026-10-28: the first shared-player release always paused at saved Apple Music
cues. The next release changed cues to always start playback. That second behavior was verified in Chrome:
production playback continued through a saved five-second cue in “Alma Rota” and resumed from it in Stage
after pausing, with native rate 1. It also handled catalog duration being available before native duration by
starting MusicKit before seeking. Its typecheck, 381 tests and build passed; delayed-start cancellation,
keyboard actions and the seven required viewport sizes were checked. These are prior-release results, not
acceptance of the current behavior below.

The owner then clarified the intended rule: **cues preserve playback state** in local files, Apple Music and
Stage. Playing music jumps and continues; paused music jumps and stays paused. Empty pads only save a cue.
This supersedes both always-pause and always-start behavior. A cue before a stream's first Play must select
the position without starting audio. Verify both states, first-Play behavior, Pause/source-change cancellation
and Stage. Keep physical-iPhone acceptance separate from desktop and automated results.

Earlier web-only tempo investigation, 2026-10-28: an explicit `?tempo-test=1#apple-music` audition used the
existing player with bounded rate presets and read-only pitch/rate/timing diagnostics, while normal entry stayed
at 100%. The owner reported that this made the slider and presets disappear from the expected interface.
The current revision removes that URL gate: the shared slider and presets are visible in the ordinary player,
with Back 10s and Talk retained and diagnostics under Playback info. The owner then confirmed, “The slider
and presets are back and all tempos sound great,” and identified the tested device as Mac. This is listening
acceptance on that Mac; exact tested rates, browser version and output route were not specified. Physical
iPhone/iPad/Android listening and uninterrupted full-track completion remain unverified. See
[APPLE_MUSIC_TEMPO_TRIAL.md](APPLE_MUSIC_TEMPO_TRIAL.md) for primary sources, the iPhone Safari/Home Screen
and Android Chrome checks, and the transport behavior that must remain intact. No native app is planned.
