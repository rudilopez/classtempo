# YouTube videos in ClassTempo

Status, October 29, 2026: YouTube is available from Library through its official embedded player. The player
polish adds consistent Tempo controls, volume ducking for Talk, inline Options and larger landscape Stage.
Publication and validation are recorded separately from implementation; physical-device acceptance of the
updated controls remains pending. The owner reported that YouTube changed-speed playback sounded great,
but did not specify a device, video or rate in that report. This is a positive listening report, not acceptance
of every video, speed or device. Earlier Apple Music and Spotify listening results do not establish YouTube quality.

## Use a video

1. In ClassTempo, open **Library → YouTube**.
2. Paste the video's YouTube link and choose **Open video**. A normal watch link, `youtu.be` share link, Shorts
   link or live-video link can identify one video. A shared start time is kept where supported. A playlist-only
   link cannot open a playlist in this source.
3. The video opens paused. Press **Play** when ready. YouTube's own player controls remain available.
4. Use the **Tempo** menu between the slower/faster buttons to change speed. **100%** means the original
   speed. The side buttons move to the next speed YouTube offers, rather than changing by 1%. The choices and
   applied rate depend on what YouTube reports for that video; a particular speed or pitch quality is not guaranteed.
5. Open **Cues**. Tap an empty number to save that position; tap a saved number to jump there. Playing video
   keeps playing, and paused video stays paused until Play. Cues are bookmarks rather than frame-accurate cuts.
6. Choose **Stage** for a larger picture and turn your phone sideways for a horizontal video. Stage uses the
   available screen with compact controls and cue strips below the video. It requests fullscreen where the
   browser supports it; otherwise it fills the app viewport. The full picture is kept without cropping. **Exit**
   returns to the regular player without replacing the embedded player.
7. Use **Talk** to quiet the sound while you speak. Where volume adjustment is available, it lowers the sound
   to 20% of its previous level. On a phone that locks volume changes, it mutes the sound instead. The player
   tells you which action is active. The picture keeps playing if it was playing. **Finish talking** restores
   the prior volume and mute state; neither action starts a paused video.
8. **Options** opens an information panel below the picture. Tap **Done** to close it. The video, position,
   speed and playing/paused state stay in place; this does not switch sources or reopen the video.

Choose **Open on YouTube** if the video cannot play embedded. You can also use **Open** for a local song/video,
or return to another source through Library. A source change stops YouTube. Its selected link remains available
when returning, ready to open again paused.

## What is available

| Feature | YouTube source |
| --- | --- |
| One video from a link | Supported through YouTube's embedded player. |
| Play, pause, seek and Restart | Available, subject to the video's seeking support and browser permission. |
| Speed | Only the choices reported by YouTube for that video; the displayed value follows the observed rate. |
| Eight saved cues | Saved in this browser by video ID, separate from other music sources. |
| Stage | Larger visible video with compact controls outside the picture; fullscreen where supported. |
| Talk | Lowers sound where supported, otherwise mutes it; preserves playback and restores the previous sound settings. |
| Options | Inline information below the picture; closing it preserves the loaded video and playback. |
| YouTube search, subscriptions or playlists | Not included; paste one video's link. |
| Practice, class plans and Stems | Use imported files. |
| Offline playback or downloads | Not included. |
| Background or lock-screen audio | Not included; hiding the app pauses this source. |

Internet is required. The embedded player determines whether a video is available; private/deleted,
age-restricted, regional or owner-disabled videos may fail to embed. Ads and YouTube's own links remain intact.
The source does not impose Spotify's five-account tester list and does not need a ClassTempo YouTube API key.
Some YouTube account-dependent viewing may require opening YouTube itself.

Opening a video contacts YouTube/Google to load their player and check availability. Playback can share
additional data under those providers' policies. ClassTempo does not download, record, extract audio from or
upload imported files to YouTube. It stores cue metadata locally; those provider cues are not part of the
local-file settings backup. See the public YouTube connection privacy page linked from the source.

## Implementation boundaries

- Load `https://www.youtube.com/iframe_api` only after explicit Open video. Use `cueVideoById` for a paused
  selection; preserve a prepared offset when a paused pre-Play seek would otherwise start the cued video.
- Create a privacy-enhanced `youtube-nocookie.com` iframe with its initial video ID, origin, referrer policy,
  native controls and permissions before insertion. The documented existing-iframe API controls that same node.
  Read the video's title from the iframe's public DOM title when available; metadata never gates transport.
- Keep YouTube's controls and advertisements visible. Its frame is at least **200×200**. ClassTempo must not
  crop, mirror or cover it; Stage resizes the same frame without moving/reparenting it. Landscape uses the
  remaining picture area above a compact playback/seek row. Enter document fullscreen only from the Stage
  gesture when available, with a viewport fallback and an explicit Exit.
- Supply the page origin, preserve the browser's `HTTP Referer` with `strict-origin-when-cross-origin`, and
  report identification error 153 rather than suppressing it.
- Use available-rate values and observed rate-change events. A cue/load can reset the speed; setting a rate is
  a request, not proof that it changed. Native controls can also change the observed rate.
- Talk uses only official native `getVolume`/`setVolume` and mute APIs. A volume-locked device uses mute
  instead of claiming that a numeric volume request audibly worked. Keep the prior volume and mute state for
  restoration, and show the active mode. Talk never pauses or starts video as a side effect. Other playback
  actions and teardown restore the sound settings. Native API readback is not physical-device listening proof.
- Options is non-covering inline content below the picture, with Done and no ambiguous source-exit button.
  It must not hide, detach, recreate or re-cue the native iframe, or reset time, speed, title or playback state.
- Pause when Library or cue editing covers the player, the document hides, or the source changes. Source exit disposes its
  owned player and cancels pending creation; stale ready/state callbacks must not revive playback.
- Keep YouTube media out of the local audio engine, separation workers, saved-media store and service-worker
  cache. No extraction, proxy download or alternate audio path is implemented.

## Failure handling

| Situation | Expected response |
| --- | --- |
| Invalid or unrelated link | Explain that a single valid YouTube video link is needed; do not load the API. |
| Deleted/private video, or embedding disabled | Explain the availability limit and offer Open on YouTube. |
| Browser blocks scripted playback | Ask the user to press Play in the visible video; do not claim it is playing. |
| Missing player identification | Report the connection issue and offer the YouTube fallback. |
| Player/API cannot load | Show a retry or another-source path; keep imported files usable. |

## Verification

### Player polish checks · October 29, 2026

The release candidate passes typecheck, **670 tests across 47 files**, and the production build. Its 48 client
unit tests cover the volume/mute state and restoration paths; a unit-test pass does not establish audible
volume changes or mute fallback on a physical iPhone. Publication must still be verified from the exact Pages
commit/deployment and live result.

Real Chrome checks used the official reference video `M7lc1UVf-VE`. At a prepared, paused **12-second** start
and **75%** speed, repeated Options open/Done/Escape cycles preserved the same native iframe, video selection,
rate and position. While playing, Talk and inline Options kept the clock advancing; the final Talk UI reported
**Audio lowered**. Cancelling Choose another YouTube video retained the same frame. Space on the Options
summary opened its details without changing playback. These observations establish control behavior in the
tested browser, not physical-phone attenuation or listening acceptance at every speed.

The main player, main Options, Stage, Stage cues, Stage tools and Stage Options passed **72 layout checks**
across twelve phone/browser/tablet sizes. There was no horizontal overflow or control overlap; native frames
remained at least 200×200 and ClassTempo touch targets at least 44px. The main player required no internal scrolling at
any tested size. With the full Options panel open, internal scrolling was needed by 34px at 360×640, 10px at
390×664, and 86px in landscape Stage; the minimum video size was preserved.

Stage kept the same iframe and used the available viewport, with a single 44px playback/seek dock in landscape.
The document-fullscreen request path was attempted, but the observed browser result verified the **CSS viewport
fallback only**, not successful native document fullscreen. Physical-phone rotation, Talk's mute fallback,
fullscreen/browser chrome and speaker listening remain separate device checks.

### Initial launch checks · October 29, 2026

Chrome browser verification used the official reference video `M7lc1UVf-VE` (22:24). It opened paused,
reported its supported rates, and played from a prepared 12-second cue. Playing cue jumps resumed playback;
paused jumps stayed paused. The applied 75% rate was reported by YouTube. A named cue and its position survived
leaving to Files & classes and explicitly reopening the retained link; source exit removed the native iframe.
Stage kept the iframe ID/source, and cue editing paused and hid the frame while its dialog was open.
The main player, Stage cues and Stage tools passed 36 viewport checks (twelve sizes each), including compact
phone browser areas, landscape and iPads: no document overflow, frames at least 200×200 and Stage controls below
the picture. Temporary test cues were cleared; no user media was changed. These checks do not establish
physical iPhone/iPad/Android listening, background interruption recovery or clean pitch at every speed.

Initial local startup failures were corrected before release: an empty initial embed lacked the video ID,
and Vite preview inherited development-only isolation headers that blocked external frames. Preview now
explicitly matches Pages' non-isolated headers. The official privacy-enhanced embed loaded successfully in
the tested Chrome browser; the standard embed had shown a refused connection. Do not infer a universal cause
for that refusal or claim it as a YouTube content restriction.

### Regression checklist

Record the exact commit/deployment and distinguish mocked API tests from a real video in the browser.

- Validate common link forms, timestamps, invalid hosts/IDs and playlist-only input.
- Cover paused selection, pre-first-Play cues, playing/paused cues, native controls, supported rates and actual
  rate reporting. Cancel late callbacks after new loads, source exit, errors and tab hiding.
- Verify repeated Options open/close cycles through each available close action keep the same iframe, title,
  position, speed and playback state,
  including a shared start time before the first Play. Verify Talk changes native volume or mutes while
  preserving playing/paused state, and restores prior volume/mute on Finish talking, other playback actions
  and source exit. Verify actual phone sound separately from API-reported values.
- Verify Stage keeps the same iframe and playing state, with an unobscured frame of at least 200×200. Check
  compact phone browser viewports, landscape and iPad layouts, internal dialog scrolling and touch targets.
- Verify default local/Apple Music use does not request YouTube, and private Spotify remains hidden until invited.
- Verify native YouTube playback, source switches, missing/blocked-video feedback and failure recovery live.
- Test the intended phone/tablet and speaker separately, including changed-speed listening, interruptions,
  tab/background transitions and installation. Desktop browser results do not establish those outcomes.

## Primary references

- [YouTube IFrame Player API](https://developers.google.com/youtube/iframe_api_reference)
- [Player parameters](https://developers.google.com/youtube/player_parameters)
- [Embedded-player requirements](https://developers.google.com/youtube/terms/required-minimum-functionality)
- [YouTube developer policies](https://developers.google.com/youtube/terms/developer-policies)
- [WebKit features in Safari 26.0: volume support and volume-lock feature detection](https://webkit.org/blog/17333/webkit-features-in-safari-26-0/)
