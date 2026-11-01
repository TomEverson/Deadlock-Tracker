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

## Build the macOS app

```bash
pnpm --filter @deadlock/desktop dist:mac
```

The `.app`, `.dmg` and `.zip` are written to `apps/desktop/release/`. The
release build is unsigned and Apple Silicon (arm64) only. On first launch,
right-click the app and choose **Open**, or clear the quarantine flag:

```bash
xattr -dr com.apple.quarantine "/Applications/Deadlock Tracker.app"
```

Published builds: <https://github.com/TomEverson/Deadlock-Tracker/releases>.

## Cloud

Live at `https://deadlock-cloud.studycafe-125.workers.dev`.

```bash
cd apps/cloud
pnpm dev                    # local Worker on :8787 (point the app at it with DEADLOCK_CLOUD_URL)
pnpm db:migrate:remote      # apply migrations to the real D1
pnpm deploy
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
