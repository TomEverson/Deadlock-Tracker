# Deadlock Tracker

A desktop app for tracking Deadlock matches with your friends. Each install
syncs match history and match details straight from Valve's Game Coordinator
with its own Steam account, keeps everything in a local SQLite database, and
shares it through a Cloudflare D1 database so the group only downloads each
match once.

Spec: [`docs/specs/desktop-app-cloud-sync.md`](docs/specs/desktop-app-cloud-sync.md)

```
apps/desktop   Electron app (main: Steam + sync + SQLite, renderer: the UI)
apps/cloud     Cloudflare Worker (Hono): Sign in with Steam (better-auth) + sync API on D1
packages/core  Shared logic: types, validators, analysis, protobufs/GC client, sync protocol
```

## Run the app

```bash
pnpm install
pnpm desktop            # dev build with hot reload
```

First launch: **Settings → Steam** (QR code or password + Steam Guard) and
**Settings → Cloud → Sign in with Steam**. Match sync is manual — use the
sidebar's **Sync now** (the friend list and names refresh on app launch
without reading any matches).

## Build the desktop apps

```bash
pnpm --filter @deadlock/desktop dist:mac    # .dmg + .zip
pnpm --filter @deadlock/desktop dist:win    # NSIS .exe + .zip
pnpm --filter @deadlock/desktop dist:linux  # .AppImage + .tar.gz
```

Artifacts are written to `apps/desktop/release/`. Build each target on its
native OS, or use the **Release** GitHub Actions workflow, which builds macOS
(arm64), Windows (x64), and Linux (x64) and attaches them to the release.
SQLite uses the N-API prebuilds shipped with `better-sqlite3`, so packaging
does not need a local node-gyp/Visual Studio toolchain.

The macOS release is ad-hoc signed and not notarized. On first launch,
right-click the app and choose **Open**, or clear the quarantine flag:

```bash
xattr -dr com.apple.quarantine "/Applications/Deadlock Tracker.app"
```

Notarization requires an Apple Developer account; see
[`docs/signing-and-notarization.md`](docs/signing-and-notarization.md).
Windows builds are unsigned, so SmartScreen may warn. Linux builds are
unsigned; the AppImage runs directly on CachyOS, and the `.tar.gz` is a
portable fallback.

Published builds: <https://github.com/TomEverson/Deadlock-Tracker/releases>.

## Cloud

Live at `https://deadlock-cloud.studycafe-125.workers.dev`.

```bash
cd apps/cloud
pnpm dev                    # local Worker on :8787 (point the app at it with DEADLOCK_CLOUD_URL)
pnpm db:migrate:remote      # apply migrations to the real D1
pnpm run deploy
```

Access is open: any Steam account that signs in can read and write the
shared data. There is no allowlist or invite step.

## Steam limits

Valve publishes none. The app keeps local 24-hour counters as a safety cap
(40 history, 45 match-detail requests) and treats Steam's own "rate limited"
answer as the real limit, pausing Steam requests for 2 hours when it happens.
Sync only updates histories; a match's details are downloaded when you open it
and ask, and cost no Steam request if another install already pushed them.
Match sync is manual, and only the friend list (normal Steam connection, no
Game Coordinator requests) refreshes on launch.

## Checks

```bash
pnpm typecheck && pnpm lint
```
