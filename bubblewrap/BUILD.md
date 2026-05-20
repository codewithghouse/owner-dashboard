# Building & publishing the Edullent Owner TWA

This folder holds the Bubblewrap configuration that wraps the PWA into a Play
Store-ready Android App Bundle (AAB).

## Prerequisites

- Node.js 18+
- Java 11+ (JDK)
- Android SDK (Bubblewrap installs what it needs on first run)
- A Google Play Console developer account ($25 one-time)
- The PWA deployed at the host listed in `twa-manifest.json` (HTTPS, valid manifest)

## One-time setup

```bash
# Install Bubblewrap globally (or run via npx)
npm install -g @bubblewrap/cli

# Verify
bubblewrap doctor
```

`doctor` will offer to install missing JDK / Android SDK pieces — accept.

## Generate the Android project

From this directory (`owner-dashboard/bubblewrap/`):

```bash
bubblewrap init --manifest=https://owner.edullent.com/manifest.webmanifest
```

When prompted:
- Confirm `packageId: com.edullent.owner` (matches `assetlinks.json`)
- App version: `1`
- Display: `standalone`
- All other fields: accept defaults from `twa-manifest.json` (Bubblewrap reads it)

Bubblewrap writes the Android project files (gradle, AndroidManifest.xml, etc.) into this folder.

## Build the release AAB

```bash
bubblewrap build
```

This compiles + signs + produces:
- `app-release-bundle.aab` (upload this to Play Console)
- `app-release-signed.apk` (sideload-testable)

The first build will create a signing keystore at `~/.bubblewrap/`. **Back this up immediately** — losing it means you can't push app updates to the same Play Store listing.

## Get the SHA-256 fingerprint

```bash
keytool -list -v -keystore ~/.bubblewrap/android.keystore -alias android
```

Copy the `SHA256:` line. Paste into:

```
owner-dashboard/public/.well-known/assetlinks.json
```

…replacing `REPLACE_WITH_YOUR_APP_SIGNING_FINGERPRINT_FROM_PLAY_CONSOLE`. Re-deploy the PWA.

**ALTERNATIVE (recommended):** use Play App Signing. Upload your AAB once, then Play Console manages the production signing key for you. Find the SHA-256 at:
> Play Console → Setup → App integrity → App signing key certificate → SHA-256

## Verify Digital Asset Links

After deploy:

```bash
curl "https://digitalassetlinks.googleapis.com/v1/statements:list?source.web.site=https://owner.edullent.com&relation=delegate_permission/common.handle_all_urls"
```

Response should include your `package_name` + fingerprint. If empty, fingerprint mismatch — TWA will show the Chrome URL bar.

## Test the APK locally

```bash
# Install on a connected Android device
adb install -r app-release-signed.apk
```

Open the app. URL bar should be **invisible** (proof: assetlinks.json is reachable + fingerprints match).

## Publish

1. Play Console → Create new app
2. App details:
   - **Title:** Edullent — Owner
   - **Short description:** "Multi-branch school analytics, finance, academics and operations."
   - **Full description:** longer version
   - **Category:** Education > Business
   - **Content rating:** Everyone (you collect education data on behalf of schools, but the end-user is an adult administrator)
3. Store listing:
   - **Feature graphic:** 1024×500 (create separately)
   - **Phone screenshots:** 4–8 captures
   - **Tablet screenshots:** 4–8 captures
   - **Privacy Policy URL:** `https://owner.edullent.com/privacy`
4. App content:
   - **Data safety:** Declare every item from privacy policy (student names, attendance, marks, parent emails, etc.) as collected + shared with Firebase + needed for app functionality. Do NOT declare ads/analytics if you aren't using them.
   - **Target audience:** Schools and educators only
5. Upload `app-release-bundle.aab` to Production track
6. Submit for review

Play review takes 2–7 days. Be ready to respond to:
- DataSafety questions
- Privacy Policy clarifications
- Sensitive permissions (you don't request any)

## Updating

When you ship a new PWA build:
- The TWA auto-loads the latest content (it's just Chrome). **No Play Store re-submit needed for content changes.**
- Bump `appVersion` + `appVersionName` in `twa-manifest.json` only when:
  - You change `packageId`, `host`, `startUrl`, or other native-app metadata
  - You want a new feature gated to a new APK version (rare)
- Then `bubblewrap update && bubblewrap build` and upload the new AAB.

## Gotchas

- **Don't change `host`** after first publish — the TWA verifies host==assetlinks domain. Changing it requires a new app listing.
- **Don't lose the keystore.** Backup `~/.bubblewrap/android.keystore` to a password manager.
- **If you switch to Play App Signing,** the upload-key fingerprint differs from the signing-key fingerprint. Use the SIGNING-key fingerprint in `assetlinks.json`.
- **`maximumFileSizeToCacheInBytes: 4MB`** in vite.config.ts means the PWA precache is capped at 4MB. Larger chunks won't be precached (they cache on first use). For TWA, this means slower first launch — consider raising the cap if your home page chunk grows.

## Useful commands

```bash
bubblewrap doctor          # diagnose env
bubblewrap update          # pull latest webmanifest changes
bubblewrap build           # rebuild AAB
bubblewrap validate        # check twa-manifest.json
bubblewrap install         # install AAB to connected device
```
