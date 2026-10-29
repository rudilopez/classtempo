# YouTube videos in ClassTempo

Status, October 29, 2026: implementation on `codex/youtube-player` passes typecheck, 638 tests and the production
build. Real Chrome playback and controls pass the browser checks below. Publication is verified separately
through the Pages deployment; physical-device acceptance remains pending.
The earlier Apple Music and Spotify listening results do not establish YouTube playback or changed-speed quality.

## Use a video

1. In ClassTempo, open **Library → YouTube**.
2. Paste the video's YouTube link and choose **Open video**. A normal watch link, `youtu.be` share link, Shorts
   link or live-video link can identify one video. A shared start time is kept where supported. A playlist-only
   link cannot open a playlist in this source.
3. The video opens paused. Press **Play** when ready. YouTube's own player controls remain available.
4. Use a supported **Tempo** choice to change speed. **100%** means the original speed. The choices and applied
   rate depend on what YouTube reports for that video; a particular speed or pitch quality is not guaranteed.
5. Open **Cues**. Tap an empty number to save that position; tap a saved number to jump there. Playing video
   keeps playing, and paused video stays paused until Play. Cues are bookmarks rather than frame-accurate cuts.
6. Choose **Stage** for a larger picture. Its compact controls and cue strip stay below the video. Exit returns
   to the regular player without replacing the embedded player.

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
| Stage | Larger visible video with controls outside the picture. |
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
  crop, mirror or cover it; Stage resizes the same frame without moving/reparenting it.
- Supply the page origin, preserve the browser's `HTTP Referer` with `strict-origin-when-cross-origin`, and
  report identification error 153 rather than suppressing it.
- Use available-rate values and observed rate-change events. A cue/load can reset the speed; setting a rate is
  a request, not proof that it changed. Native controls can also change the observed rate.
- Pause when a dialog covers the player, the document hides, or the source changes. Source exit disposes its
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

## Verification checklist

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

Record the exact commit/deployment and distinguish mocked API tests from a real video in the browser.

- Validate common link forms, timestamps, invalid hosts/IDs and playlist-only input.
- Cover paused selection, pre-first-Play cues, playing/paused cues, native controls, supported rates and actual
  rate reporting. Cancel late callbacks after new loads, source exit, errors and tab hiding.
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
