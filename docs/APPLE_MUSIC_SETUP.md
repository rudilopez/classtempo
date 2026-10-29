# Apple Music setup for ClassTempo

This configures the Apple Music source in the familiar ClassTempo player. Songs open paused at 100%, with
the slider and presets visible. The owner confirmed clear changed-speed playback on Mac on 2026-10-28.
Setup alone does **not** establish playback quality, stems, offline
access or iPhone acceptance. Local songs, videos and classes retain their existing storage and playback engine.
Follow [APPLE_MUSIC_FEASIBILITY.md](APPLE_MUSIC_FEASIBILITY.md) for the device test after setup.

Current setup, 2026-10-28: Apple Developer membership is active. The MusicKit-only Media ID
`media.io.github.rudilopez.classtempo` and its Media Services key have been created, and all three GitHub
Actions repository secrets below are configured. Steps 1 and 2 are complete; do not create duplicate
identifiers or keys for this setup. The configured deployment and production Chrome subscriber authorization
succeeded. Read-only catalog/library browsing, paused song selection, Play/Pause, seeking and stopping streaming
when returning to the local player were verified. The owner confirmed clear audio at 100%, with playback
observed beyond the preview range. Slower playback
warbled and faster playback changed pitch, so the first speed experiments were removed. The owner later
requested visible slider/preset controls in the ordinary player. After their restoration, the owner confirmed
all tempos sounded great on Mac. The subsequent iPhone listening check failed at 75%, with warbling despite
matching requested/SDK/native rates and enabled pitch preservation. Playback info retains read-only diagnostics.
Other iPhone rates, iPad/Android listening and uninterrupted full-track completion remain unverified.
See the dated evidence in [APPLE_MUSIC_FEASIBILITY.md](APPLE_MUSIC_FEASIBILITY.md).

## 1. Create the Apple identifier and key

Use the enrolled Apple Developer account as Account Holder or Admin:

1. Open **Certificates, Identifiers & Profiles → Identifiers → + → Media IDs**.
2. Use **ClassTempo** as the description, choose a unique reverse-domain identifier, and enable MusicKit.
   Register it. The description is the name people see when asked to authorize Apple Music.
3. Open **Keys → +**. Create a **Media Services** key and associate it with the ClassTempo Media ID.
4. Download the `.p8` private key and keep it securely outside the repository. Apple allows this download once.
5. Note the key's **Key ID** and the account's **Team ID** from Membership information. Both have 10 characters.

See Apple's [Media ID setup](https://developer.apple.com/help/account/capabilities/create-a-media-identifier-and-private-key),
[private-key instructions](https://developer.apple.com/help/account/keys/create-a-private-key) and
[developer-token requirements](https://developer.apple.com/documentation/applemusicapi/generating-developer-tokens).

## 2. Add three GitHub Actions repository secrets

In this repository on GitHub, open **Settings → Secrets and variables → Actions → New repository secret**:

| Secret name | Value |
| --- | --- |
| `APPLE_MUSIC_TEAM_ID` | The 10-character Team ID |
| `APPLE_MUSIC_KEY_ID` | The 10-character Key ID |
| `APPLE_MUSIC_PRIVATE_KEY` | The complete `.p8` text, including BEGIN/END lines and actual line breaks |

Use **repository secrets**, because the build job signs the token before the Pages deployment job.
Do not place the private key in a repository variable, a `VITE_` variable, source code, an issue or chat.
The workflow passes these three secrets only to the signing step; the Vite build receives a public enabled flag.
GitHub documents [adding and using Actions secrets](https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/use-secrets).

## 3. Deploy and verify the setup

After this implementation is on `main`, open **Actions → Deploy to GitHub Pages → Run workflow** and select `main`.
A successful build generates `apps/web/public/apple-music-config.json` and publishes it with the app. The file
contains only `developerToken` and `expiresAt` (Unix seconds). This developer token is intentionally public;
the signing private key stays in the Actions secret and runner memory.

The configured build shows Apple Music in Library's persistent Streaming row. The On this device and Streaming
navigation, loaded-item footer and Back to player action remain visible while browsing Search, My songs and
Playlists. Browsing another destination keeps the loaded track and does not switch playback sources. Select a
song to open it paused and close Library. Playlists are read-only here; create or edit them in the Apple Music
app. Streaming songs cannot be added to ClassTempo's local-file Class plans. The direct `#apple-music` route remains
available for setup information even before credentials exist. Check that the source picker opens and that
selecting a song returns to the familiar player paused, then follow the feasibility checklist with a suitable
Apple Music account. A successful signature or deployment
does not prove Apple accepts the key or that a subscribed track plays on the target device.

With **all three secrets absent**, deployment succeeds without the config file or Library entry. With a
**partial or invalid setup**, signing fails and that build cannot deploy. Fix all three secrets together or
remove all three to disable the setup. Failed deployments leave the previously deployed site in place.

## Token lifetime and refresh

The signer uses Node's built-in crypto: **ES256 (P-256/SHA-256)** with a JWT-compatible 64-byte signature.
It validates the Team ID, Key ID, key curve and token timestamps. Tokens last **30 days**, below Apple's
maximum **15,777,000 seconds**. The token's `origin` array contains only **`https://rudilopez.github.io`**—
an origin has no `/classtempo/` path. It therefore does not authorize a localhost or different-domain client.
Apple documents these fields and the origin restriction in
[Generating Developer Tokens](https://developer.apple.com/documentation/applemusicapi/generating-developer-tokens).

The existing Pages workflow refreshes and redeploys every **Monday at 07:23 UTC**, as well as on `main` pushes
and manual runs. The service worker does not cache the configuration, so reopening Apple Music can fetch
the current deployment's token. The app does not generate or renew tokens in the browser.

Check failed Actions runs. GitHub schedules can be delayed, run only from the default branch, and can be
disabled after 60 days without repository activity in a public repository. This is a scheduled refresh, not
an uptime guarantee. Re-enable the workflow and run it manually if needed before the token expires. See
[GitHub's schedule behavior](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule).

To rotate a key, create another associated key, replace the Key ID/private-key secrets, deploy and verify it,
then revoke the old key. If a key is compromised, use Apple's account controls to revoke it; deleting a config
file alone does not revoke an already issued token. Apple's [Media ID/key guide](https://developer.apple.com/help/account/capabilities/create-a-media-identifier-and-private-key)
describes the normal rotation order.

## Local checks for developers

Run `npx vitest run scripts/apple-music-token.test.mjs` for tests using temporary, generated keys. They never
need Apple credentials or make Apple requests.

`npm run apple-music:config` runs the same signer locally against the three process environment variables.
It removes any previous generated file before checking configuration. It does not read `.env` files or print
the key/token. With no credentials it simply removes the generated configuration. `npm run build` does not
automatically sign; production signing is an explicit workflow step. For a configured local build, run the
signer first, then build with `VITE_APPLE_MUSIC_ENABLED=true`. The production-origin token still cannot be used
from localhost; use the deployed Apple Music source for authenticated testing.

Generated config, `.env*` files and `.p8` keys are ignored by Git. No private key or Music User Token belongs in
the published output. Only a developer token is generated here; authorization of a listener remains a separate,
explicit MusicKit step.
