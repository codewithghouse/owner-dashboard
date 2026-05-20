# Digital Asset Links — TWA setup

`assetlinks.json` enables Trusted Web Activity (TWA) on Play Store: the Android wrapper
opens this PWA fullscreen WITHOUT a Chrome URL bar.

## How to fill in the SHA256 fingerprint

1. Generate a signing key (one-time):
   ```bash
   keytool -genkey -v -keystore edullent-owner.keystore \
     -alias edullent -keyalg RSA -keysize 2048 -validity 36500
   ```

2. Get the SHA256 fingerprint:
   ```bash
   keytool -list -v -keystore edullent-owner.keystore -alias edullent
   ```
   Copy the line `SHA256: AA:BB:CC:...`.

3. **OR** use Play Console's auto-signing (recommended):
   - Upload your APK once → Play takes over signing
   - In Play Console → Setup → App integrity → Copy the **SHA-256 certificate fingerprint** (Google Play app signing certificate)

4. Paste the fingerprint into `assetlinks.json` (replace
   `REPLACE_WITH_YOUR_APP_SIGNING_FINGERPRINT_FROM_PLAY_CONSOLE`).

5. Deploy. Verify at:
   `https://digitalassetlinks.googleapis.com/v1/statements:list?source.web.site=https://owner.edullent.com&relation=delegate_permission/common.handle_all_urls`

## Package name

Currently `com.edullent.owner` — change in BOTH this file AND the Bubblewrap/Android Studio
project before publishing.

## Multi-fingerprint case

If you ship one keystore for debug builds and another (Play Console managed) for prod,
add BOTH fingerprints to `sha256_cert_fingerprints` array:
```json
"sha256_cert_fingerprints": [
  "AA:BB:CC:DD:...prod...",
  "11:22:33:44:...debug..."
]
```
