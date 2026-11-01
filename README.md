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
**Settings → Cloud → Sign in with Steam**. Sync runs on launch and every 30
minutes; the sidebar has a **Sync now** button.

## Cloud

Live at `https://deadlock-cloud.studycafe-125.workers.dev`.

```bash
cd apps/cloud
pnpm dev                    # local Worker on :8787 (point the app at it with DEADLOCK_CLOUD_URL)
pnpm db:migrate:remote      # apply migrations to the real D1
pnpm deploy
```

Access is allowlist-only. The admin (`ADMIN_ACCOUNT_ID` in `wrangler.toml`)
is allowed automatically and adds friends in **Settings → Cloud** by account
ID, SteamID64 or profile URL. Removing someone also signs them out.

## Steam limits

Valve publishes none. The app stays under what deadlock-api uses per account:
40 history and 45 match-detail requests per 24 h, and pauses Steam requests
for 2 hours if Steam answers "rate limited". Details already in the cloud
cost no Steam requests.

## Checks

```bash
pnpm typecheck && pnpm lint
```
