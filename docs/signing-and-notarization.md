# Signing and notarizing the macOS app

The current `v0.1.0` build is **ad-hoc signed**, which is enough for
Apple Silicon to run it locally, but it is **not notarized**. macOS will show
the "unidentified developer" warning until the app is signed with a Developer
ID certificate and notarized by Apple.

Notarization cannot be applied to an ad-hoc signature. You need an Apple
Developer account.

## Requirements

- An active [Apple Developer Program](https://developer.apple.com/programs/)
  membership (paid, currently $99/year).
- A **Developer ID Application** certificate and its private key.
- Your 10-character **Team ID**.
- Either an app-specific password for your Apple ID, or an App Store Connect
  API key.

You do **not** need to publish the app on the App Store for notarization.

## 1. Create the Developer ID certificate

1. Open <https://developer.apple.com/account/resources/certificates/list>.
2. Choose **Certificates → + → Developer ID Application**.
3. Follow the CSR steps, download the `.cer`, and double-click it to install
   it in your login keychain.
4. In **Keychain Access**, find the certificate and its private key, then
   export both as a `.p12` file with a password.

The certificate name looks like:

```text
Developer ID Application: Tom Everson (ABCDE12345)
```

The value in parentheses is your Team ID.

## 2. Create notarization credentials

### Option A: Apple ID + app-specific password

1. Sign in at <https://appleid.apple.com>.
2. Under **Sign-In and Security → App-Specific Passwords**, create one named
   `Deadlock Tracker notarization`.
3. Save the generated password (format `xxxx-xxxx-xxxx-xxxx`).

### Option B: App Store Connect API key

1. Open **App Store Connect → Users and Access → Integrations → App Store
   Connect API**.
2. Create a key with the **Developer** role and download the `.p8` file.
3. Note the **Key ID** and **Issuer ID**.

## 3. Enable signing and notarization

In `apps/desktop/package.json`, change the `build.mac` block:

```json
"mac": {
  "category": "public.app-category.games",
  "icon": "build-resources/icon.icns",
  "hardenedRuntime": true,
  "gatekeeperAssess": false,
  "entitlements": "build-resources/entitlements.mac.plist",
  "entitlementsInherit": "build-resources/entitlements.mac.plist",
  "notarize": true,
  "target": [
    { "target": "dmg", "arch": ["arm64"] },
    { "target": "zip", "arch": ["arm64"] }
  ],
  "artifactName": "Deadlock-Tracker-${version}-${arch}.${ext}"
}
```

Remove `"identity": null` and `"notarize": false` from the existing block.
Do not remove `hardenedRuntime: true`; notarization requires it.

The `build-resources/entitlements.mac.plist` file already contains the
standard Electron entitlements.

## 4. Build with credentials

Using a `.p12` file:

```bash
CSC_LINK="$PWD/certs/DeveloperIDApplication.p12" \
CSC_KEY_PASSWORD="the-p12-password" \
APPLE_ID="you@example.com" \
APPLE_APP_SPECIFIC_PASSWORD="xxxx-xxxx-xxxx-xxxx" \
APPLE_TEAM_ID="ABCDE12345" \
pnpm --filter @deadlock/desktop exec electron-builder --mac --arm64 --publish never
```

Or, if the certificate is already in your login keychain:

```bash
CSC_NAME="Developer ID Application: Tom Everson (ABCDE12345)" \
APPLE_ID="you@example.com" \
APPLE_APP_SPECIFIC_PASSWORD="xxxx-xxxx-xxxx-xxxx" \
APPLE_TEAM_ID="ABCDE12345" \
pnpm --filter @deadlock/desktop exec electron-builder --mac --arm64 --publish never
```

With an API key instead of an Apple ID:

```bash
APPLE_API_KEY="$PWD/AuthKey_XXXXXXXXXX.p8" \
APPLE_API_KEY_ID="XXXXXXXXXX" \
APPLE_API_ISSUER="00000000-0000-0000-0000-000000000000" \
pnpm --filter @deadlock/desktop exec electron-builder --mac --arm64 --publish never
```

`electron-builder` signs the app with the Developer ID certificate and submits
it to Apple's notary service. The app is stapled automatically.

## 5. Verify the result

```bash
APP="apps/desktop/release/mac-arm64/Deadlock Tracker.app"

codesign --verify --deep --strict --verbose=2 "$APP"
spctl -a -vvv -t install "$APP"
xcrun stapler validate "$APP"
```

`spctl` should report:

```text
accepted
source=Notarized Developer ID
```

If the DMG itself needs a ticket (for example, for distribution outside the
app), notarize and staple the DMG too:

```bash
DMG="apps/desktop/release/Deadlock-Tracker-0.1.0-arm64.dmg"

xcrun notarytool submit "$DMG" \
  --apple-id "$APPLE_ID" \
  --password "$APPLE_APP_SPECIFIC_PASSWORD" \
  --team-id "$APPLE_TEAM_ID" \
  --wait

xcrun stapler staple "$DMG"
```

## GitHub Actions secrets

To notarize in CI, add these repository secrets
(**Settings → Secrets and variables → Actions**):

| Secret | Value |
| --- | --- |
| `APPLE_CERTIFICATE` | base64-encoded `.p12` (`base64 -i cert.p12 \| pbcopy`) |
| `APPLE_CERTIFICATE_PASSWORD` | the `.p12` export password |
| `APPLE_ID` | Apple ID email |
| `APPLE_APP_SPECIFIC_PASSWORD` | app-specific password |
| `APPLE_TEAM_ID` | 10-character Team ID |

Then import the certificate on the macOS runner:

```bash
echo "$APPLE_CERTIFICATE" | base64 --decode > /tmp/cert.p12
security create-keychain -p actions build.keychain
security default-keychain -s build.keychain
security unlock-keychain -p actions build.keychain
security import /tmp/cert.p12 -k build.keychain \
  -P "$APPLE_CERTIFICATE_PASSWORD" -T /usr/bin/codesign
security set-key-partition-list -S apple-tool:,apple: -s -k actions build.keychain
```

Set `CSC_LINK=/tmp/cert.p12`, `CSC_KEY_PASSWORD` to the same password, and the
`APPLE_*` variables for the build step.

## Windows and Linux

- **Windows** has no Apple-style notarization. The current installer is
  unsigned, so SmartScreen may warn. To remove the warning you need a Windows
  code-signing certificate (OV/EV) or Azure Trusted Signing, and then sign the
  `.exe` with `signtool`. That is separate from Apple notarization.
- **Linux** has no notarization. The AppImage and `.tar.gz` builds are
  unsigned; CachyOS/Arch users can run the AppImage directly or extract the
  `.tar.gz`. Distro package signing (e.g. a pacman package) is optional and
  separate.
