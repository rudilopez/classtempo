# Apple Music feasibility — ClassTempo

Status, 2026-10-28: **developer account active and signing credentials configured; authenticated playback not verified**.
The signed-in Developer website confirmed active membership. The MusicKit-only Media ID
`media.io.github.rudilopez.classtempo` and an associated Media Services key were created. All three signing
credentials are stored as GitHub Actions repository secrets. The configured Pages deployment succeeded;
Apple's catalog API accepted the developer token, and the production Library link opened the connection
screen and Apple's sign-in window in Chrome. Listener authorization and full-track playback still require
separate verification; no authenticated desktop or physical-iPhone result is established.
ClassTempo's teaching player continues to use imported local songs and videos.

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

## Prepared connection screen

`#apple-music` loads in a fresh document so the local engine and provider player cannot overlap. A configured
build exposes **Library → Apple Music · Connection test**. Without credentials, that entry is absent and the
direct route explains the missing setup. Apple's SDK loads only inside this route after valid config arrives.
Connect invokes `authorize()` directly in a tap; cancellation is not treated as authorization. Catalog search,
library songs, playlists and playlist tracks are read-only and limited visibly to their first 25 items. Selecting
a song queues it paused; Play is a second explicit gesture. No local file identity, practice or class record is
created for the stream. Disconnect clears visible account lists; stale requests cannot restore them.

Play/Pause, Restart and seeking use MusicKit directly. A collapsed test panel requests 75%, 100% or 110% and
can compare source-time progress with ten seconds of wall time. It explicitly requires listening for pitch and
clarity. Timings do not establish audible quality, full-track entitlement or a physical-iPhone pass. Phrase
repetition, native speaker routing and integration into local class sets are not implemented in this spike.
Expired config stops the test and requires reloading fresh configuration. Raw SDK failures and tokens are not
copied into UI diagnostics. A cancelled/stuck account attempt can be abandoned by reloading the connection.

## Bounded iPhone spike

Use MusicKit on the Web v3 in an isolated diagnostic screen, with explicit user authorization, after verifying the configured deployment. Do not place experimental controls in the teaching player.

1. Sign in, search the catalog and read the user's library/playlist without changing it.
2. Play a full subscribed track from a tap over the instructor's actual Bluetooth/AirPlay speaker connection. Record iOS version, browser versus installed PWA, SDK version, account/subscription status, and connection.
3. Test 100%, 75%, and 110% playback. Confirm actual elapsed source-time versus wall-time and listen for preserved pitch; setting a property alone is not acceptance.
4. Seek to a saved time, repeat a 10-second phrase ten times, and measure boundary delay and cumulative drift. Test a finite repeat count, start delay, pause during the gap, manual seek, and switching tracks.
5. Lock/unlock, use headphone controls, interrupt with a call, leave/return to the app, and disconnect/reconnect the speaker. Confirm state follows actual audible playback.
6. Disable networking. Report exactly what the provider supports; do not label a subscription download as a locally cached ClassTempo file.
7. Sign out and expire/revoke the token. Confirm recoverable errors and that no stale timer starts playback.

Publish only capabilities demonstrated on the physical iPhone. If web playback cannot provide reliable pitch-preserving tempo and phrase control, evaluate a native iOS MusicKit build before promising streaming parity. Keep the local player independent so this experiment cannot regress teaching sessions.

## Classroom use and Spotify

Technical playback and permitted classroom use are separate checks. [Apple's consumer terms](https://www.apple.com/legal/internet-services/itunes/us/terms.html) specify personal, noncommercial use. Confirm a permitted music source/arrangement for the intended commercial classes before positioning the streaming integration for that use.

[Spotify's standard developer policy](https://developer.spotify.com/policy) explicitly excludes products targeted at businesses, including dance studios; its [support guidance](https://support.spotify.com/us/article/spotify-public-commercial-use/) excludes public playback in those settings. Do not advertise Spotify classroom playback under those standard terms. No Spotify integration is shipped.

## Remaining evidence

Activation evidence on 2026-10-28:

- [Configured Pages deployment](https://github.com/rudilopez/classtempo/actions/runs/40712530896) succeeded.
- The public configuration returned HTTP 200 with a 30-day token restricted to the production origin.
- Apple's catalog search returned HTTP 200 and a song using that developer token, without a user token.
- Production Chrome: Library entry visible, SDK initialized, Connect opened Apple's sign-in page.
- Typecheck, all 349 tests and build passed.

There is no authenticated desktop MusicKit run or physical-iPhone streaming result. Listener authorization,
full-track playback and the device tests still need verification. Catalog access does not establish a
subscriber's playback entitlement. Local class tools remain independent.
