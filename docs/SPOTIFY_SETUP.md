# Spotify setup and verification

Status, October 28, 2026: the ClassTempo Spotify application is registered in Development mode, its exact
production redirect and SDK/API selections are verified, and its public client ID is configured in GitHub
Actions. The configured deployment succeeded and the live Spotify choices enable Continue at 100%. Spotify’s
ClassTempo consent screen is open, awaiting the owner’s account grant; real account/playback acceptance still
requires verification. YouTube is deferred. App registration and the owner’s acceptance of
Spotify’s registration agreement do not establish Spotify approval of ClassTempo’s use case.

## Product limits

Library → Spotify explains original-speed-only playback, Premium and internet requirements, unavailable
Practice/Stems/class plans/offline playback, and Spotify’s personal/noncommercial restriction. It offers Apple
Music (with a playlist-transfer explanation), Open a file, Files & classes, or Continue at 100% when configured.
Unconfigured builds keep Continue disabled with an explicit setup message. The notice does not override provider
terms. Spotify’s standard developer policy excludes business-targeted uses including dance studios; confirm an
eligible use/agreement before enabling this integration for that purpose.

Development access can read playlist contents only where the signed-in user owns or collaborates on the
playlist. Followed Spotify/editorial playlists may be unavailable. The player explains this restriction on a
denied playlist request and offers another playlist, Search or Saved songs.

## Configuration and evidence checklist

The following records the verified setup separately from the remaining acceptance checks.

| Item | Status and evidence |
| --- | --- |
| Developer application | Registered as ClassTempo; Basic Information shows Development mode. |
| Intended-use description | Truthfully discloses the local-file, Apple Music and teaching app, with Spotify restricted to private, original-speed personal testing. Registration is not provider use-case approval. |
| Production redirect | Verified exactly as `https://rudilopez.github.io/classtempo/`. |
| Products | Web API and Web Playback SDK selected and verified. |
| Registration agreement | Accepted by the owner; the agent did not accept on the owner’s behalf. |
| Public client ID | Stored as GitHub Actions repository variable `SPOTIFY_CLIENT_ID`; a client secret was neither viewed nor used. |
| Deployment | [Actions run 40777058834](https://github.com/rudilopez/classtempo/actions/runs/40777058834) succeeded on `56b5138129ccaeb60ea941a002e56741ce6a0266` after setting the variable. Live `#spotify` enables Continue at 100%. |
| Automated checks | Typecheck, 534 tests and production build passed for [PR #38](https://github.com/rudilopez/classtempo/pull/38). |
| Premium membership | The signed-in owner’s Spotify Account Overview confirms Premium Family. |
| Development users | User Management lists 0/5 explicit test users. Owner API access has not yet been verified; do not infer eligibility from Developer sign-in or Premium alone. |
| Real account authorization | Pending. Connect opened Spotify’s official consent screen naming ClassTempo and the signed-in owner; the account grant awaits the owner’s Agree action. |
| Real protected playback | Pending; catalog metadata and mock SDK checks do not establish complete subscribed-song playback. |
| Physical phones | Pending; iPhone/Android listening, interruptions and background behavior remain separate acceptance checks. |

Do not mark pending rows complete from a successful app registration, deployment or consent screen alone.

## Account/app configuration

1. Use the eligible Spotify Premium account in https://developer.spotify.com/dashboard. Register a developer
   application truthfully describing ClassTempo and the intended use. Do not accept legal agreements for the owner.
2. Select Web API and Web Playback SDK. Register the exact HTTPS redirect URI:
   `https://rudilopez.github.io/classtempo/`. Privacy URL: `https://rudilopez.github.io/classtempo/spotify-privacy.html`.
3. For local development, separately register `http://127.0.0.1:5173/`; Spotify rejects localhost aliases.
4. Add approved test accounts to the developer allowlist. Current development access is limited to five users
   and requires the app owner’s Premium subscription; this is not public production access.
5. Add the app’s **public client ID** as GitHub Actions repository variable `SPOTIFY_CLIENT_ID`. The deployment
   passes it as VITE_SPOTIFY_CLIENT_ID, with the production redirect URI. No client secret is used or published.
6. Local dev can set VITE_SPOTIFY_CLIENT_ID and VITE_SPOTIFY_REDIRECT_URI in an ignored `.env.local`. Never put
   real tokens, passwords or a client secret in source, fixtures, chat, diagnostics or screenshots.
7. Deploy after required checks and verify the exact deployment. Missing configuration is intentional and must
   not show a fake successful connection or play a preview disguised as a full song.

## Authorization and privacy

The integration uses Authorization Code + PKCE S256 with state validation and a ten-minute single-use verifier.
Required SDK scopes are streaming, user-read-private and user-read-email per Spotify’s official how-to. ClassTempo
never independently retrieves or stores email. Read-only library/playlist scopes enable browsing; playback scope
starts tracks only on this browser device. No library/playlist write permission is requested.

Tokens remain in sessionStorage. Disconnect invalidates pending auth/refresh and clears Spotify tokens, lists and
saved Spotify cues. For full grant revocation, remove ClassTempo in Spotify’s connected-app settings. The public
privacy page explains the distinction. No imported file or Apple data is cleared.

## Before claiming playback works

Implementation verification, October 28, 2026: typecheck, all 534 tests and production build passed for PR #38,
including the playlist-specific 403 explanation and cancellation regression tests. An earlier mocked SDK/API
browser run verified paused song selection, first Play at a prepared cue, playing/paused cue behavior,
pending-start cancellation, disconnect and source exit. Loaded-artwork main layouts passed at twelve sizes;
Stage and the upfront choices passed at seven phone/tablet/desktop sizes. The unconfigured release screen
keeps all choices visible at 360×640 and disables Continue. These checks use no real Spotify credentials or
protected audio and do not establish account eligibility, audible playback or physical-device acceptance.

- Authorize a real eligible account, browse catalog/saved songs/playlists, select a track paused and explicitly Play.
- Confirm a complete subscribed song at 100%, not only the preview or metadata. Verify source attribution/track link.
- Set empty cues; jump while playing and paused, including before the first Play. Pause during pending Play/seek,
  switch sources and reject stale callbacks. Connecting/selecting must not transfer or interrupt another device.
- Test unavailable Premium/allowlist, expired/revoked authorization, network/rate limits, SDK not-ready and denied autoplay.
- Check the phone-first required layouts, main player, Stage cue/tools trays and focus behavior. Spotify artwork
  remains uncropped/unblurred and separate from titles/controls; missing images preserve usable controls.
- On physical iPhone and Android, test speaker/Bluetooth, interruptions/background/lock, and source exit. Desktop
  and mocked SDK checks establish implementation behavior only, not audible/phone acceptance.

## Official references

- https://developer.spotify.com/documentation/web-playback-sdk/reference
- https://developer.spotify.com/documentation/web-playback-sdk/howtos/web-app-player
- https://developer.spotify.com/documentation/web-api/tutorials/code-pkce-flow
- https://developer.spotify.com/documentation/web-api/concepts/redirect_uri
- https://developer.spotify.com/documentation/web-api/concepts/quota-modes
- https://developer.spotify.com/documentation/design
- https://developer.spotify.com/policy
