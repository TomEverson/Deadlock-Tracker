---
title: Spec — Desktop app with Cloudflare sync
description: Turn Deadlock Tracker into an Electron app that syncs from Steam locally and shares data through Cloudflare D1
type: spec
created: 2026-11-01
status: approved
---

# Spec — Desktop app with Cloudflare sync

## Problem

The tracker is a local website plus terminal commands (`pnpm dev`, `pnpm sync`, `pnpm match`).
Only the person at that machine can use it, it needs a terminal, and every install
downloads match details from Valve on its own. Valve allows roughly **50 match-detail
lookups per Steam account per day**, so building up full analysis history is slow, and
when several friends play the same match each of them pays for it.

## Goals

- A desktop app (Electron) for **you and your friends**. No terminal.
- **Steam sync runs inside the app** with the user's own Steam account (Game Coordinator
  history + match details), exactly as `pnpm sync` does today.
- **Local first:** each install keeps its own SQLite database. Pages are instant and work offline.
- **Cloudflare D1 as the shared backup and lookup.** Every install pushes what it syncs
  and pulls what it's missing, so:
  - a match's details are downloaded from Valve **once for the whole group**;
  - you can open a friend's history even if you never synced it yourself;
  - a new install (or new computer) restores from the cloud instantly.
- **Sign in with Steam** to write to the cloud; only allowlisted SteamIDs (you + invited friends).
- Keep the current UI (Linear-style redesign) as the app's renderer.

## Non-Goals

- No public website. The Cloudflare Worker is an API only.
- No mobile app.
- No real-time collaboration (sync on a schedule and on demand is enough).
- Not replacing deadlock-api for player search, teammate stats, or hero/item art (for now).
- Auto-update and code signing are out of scope for the first release.

## Proposed Solution

### Pieces

```
apps/desktop     Electron app
  main/          Node side: Steam (steam-user), local SQLite, sync engine, scheduler
  preload/       typed IPC bridge (contextBridge)
  renderer/      React UI (today's routes and components, TanStack Router SPA)
apps/cloud       Cloudflare Worker: better-auth + Steam sign-in, sync API, D1
packages/core    shared: schema/migrations, types, validators, protobufs,
                 metadata trimming, match analysis, formatting
```

pnpm workspace. Today's `src/domain/*` code moves mostly as-is into `packages/core`
(pure logic) and `apps/desktop/renderer` (components and routes).

### Key decisions

1. **Electron.** The Steam client (`steam-user`) only runs on Node, and Electron runs Node
   in the main process, so today's sync code runs unchanged. Tauri would need a Node sidecar
   or a Rust rewrite.
2. **Same SQLite schema locally and in D1.** D1 is SQLite, so one set of SQL migrations in
   `packages/core/migrations` applies to both. Kysely queries are shared; only the dialect
   differs (`better-sqlite3` locally, `kysely-d1` in the Worker).
3. **IPC replaces TanStack Start server functions.** The renderer calls
   `window.api.players.overview(id)` etc.; the main process runs the same service code
   against local SQLite. No local HTTP server.
4. **Local first, cloud as shared cache.** Reads always hit local SQLite. The sync engine
   pushes new local rows to the cloud and pulls rows the install doesn't have.
5. **Match details: cloud before Valve.** Before using a Steam request, the app asks the
   cloud which missing match details it already has and pulls those first. Only the rest
   are fetched from Valve, then pushed so nobody else needs to fetch them.
6. **Viewer-relative data stays local.** "Is my friend" and "is me" depend on who's
   looking, so `player.is_friend` / `is_self` stay local. The cloud keeps a per-user
   friends table instead.
7. **Sign in with Steam = Steam OpenID 2.0**, verified by the Worker, then a better-auth
   session (bearer token) for the app. better-auth has no built-in Steam provider (Steam
   isn't OAuth2), so this is a small custom better-auth plugin.
8. **Allowlist.** Only SteamIDs on the allowlist can sign in. You (admin) add friends by SteamID.
   All allowlisted users can read everything in the cloud (it's a friend group).

### Flows

**First launch**
1. Sign in with Steam (OpenID in an app window) → cloud session, stored in the OS keychain
   (Electron `safeStorage`).
2. Connect the Steam client for syncing: QR code (Steam mobile app) or username/password +
   Steam Guard. Only the refresh token is kept, in the keychain. The app checks that this
   account is the same SteamID as the cloud sign-in.
3. Pull from the cloud: your history, your friends' histories, every match detail
   referenced → the app is fully populated without touching Steam.
4. Optional one-time import of the old local database (`.wrangler/state`), then push it.

**Background sync** (on launch, every 30 min, and the Sync button)
1. Skip if you're in a game (already handled by `steam-user` `playingState`).
2. Friends list + histories from the Game Coordinator (watermark logic, 40/day history budget).
3. Missing details → ask cloud → pull hits → Valve for the rest (≈45/day cap, back off for
   2 h after a Steam rate-limit).
4. Push everything new to the cloud (outbox).
5. Notify: "3 new matches · 2 friends played".

**Opening a page** reads local SQLite. If a friend's profile has nothing locally, the app
pulls it from the cloud first (when online).

## Data Model / Schema

Shared tables (local and D1, from `packages/core/migrations`):

| Table | Key | Notes |
|---|---|---|
| `player` | `account_id` | profile fields + `updated_at`. Local-only columns: `is_self`, `is_friend`, `last_viewed_at`. |
| `player_match` | `(account_id, match_id)` | immutable history rows |
| `match_detail` | `match_id` | trimmed metadata JSON (~36 KB), `v`, `fetched_at`, `fetched_by` (cloud) |

Cloud-only (D1):

| Table | Purpose |
|---|---|
| better-auth `user`, `session`, `account`, `verification` | auth; `user.steam_id` |
| `allowlist (steam_id PK, added_by, added_at, role)` | who may sign in; `role` = admin/member |
| `user_friend (user_id, account_id)` | each user's Steam friends, replaced on each push |
| `change_log (seq PK autoincrement, table, key, at)` | ordered change feed for incremental pulls |

Local-only:

| Table | Purpose |
|---|---|
| `outbox (table, key, queued_at)` | rows waiting to be pushed |
| `sync_state (key PK, value)` | pull cursor (`change_log.seq`), last sync times, rate-limit backoff |
| `match_detail_attempt`, `sync_log` | as today |

Conflict rules: `player_match` and `match_detail` are immutable (insert-or-ignore; a newer
`match_detail.v` replaces an older one). `player` profile fields are last-write-wins by `updated_at`.

## API / Interface

**Cloud Worker** (`https://deadlock-sync.<you>.workers.dev`), JSON, `Authorization: Bearer <session>`:

| Route | Input | Output |
|---|---|---|
| `GET /auth/steam/start` | `redirect` (app deep link) | 302 to Steam OpenID |
| `GET /auth/steam/callback` | OpenID params | verifies with Steam, checks allowlist, creates session → 302 to `deadlock-tracker://auth?token=…` |
| `POST /v1/push` | `{ players[], playerMatches[], matchDetails[], friends[] }` (chunked, ≤ ~2 MB) | `{ accepted, skipped }` |
| `GET /v1/pull?since=<seq>&limit=` | | `{ rows by table, nextSeq, done }` |
| `POST /v1/details/lookup` | `{ matchIds[] }` | `{ have: matchId[] }` |
| `POST /v1/details/get` | `{ matchIds[] }` (≤ 50) | `{ details[] }` |
| `GET/POST /v1/admin/allowlist`, `DELETE /v1/admin/allowlist/:accountId` | `{ accountId, role }` (admin only) | `{ ok }` / entries |

**Desktop IPC** (`window.api`, typed in `packages/core`): `players.overview`, `players.friends`,
`matches.detail`, `sync.now`, `sync.status` (event stream), `steam.login*`, `cloud.signIn`,
`settings.*`. These wrap today's service functions.

## Domain Placement

- `packages/core/src/domain/{players,matches,assets,sync}/` — types, validators, services
  (pure), analysis, trimming.
- `packages/core/src/steam/` — protobufs, GC client, metadata download (Node-only, used by desktop main).
- `apps/desktop/src/main/` — `db/` (better-sqlite3 + Kysely), `sync/` (engine, scheduler,
  outbox, cloud client), `ipc/`.
- `apps/desktop/src/renderer/` — `routes/`, `domain/*/components` (today's UI).
- `apps/cloud/src/` — `auth/` (better-auth + Steam plugin), `routes/` (push/pull/details/admin), `server/db.ts`.

## Decisions (answered 2026-11-01)

- **Platforms:** macOS and Windows (Electron builds both).
- **Code signing:** none. Unsigned builds; the friends README explains right-click → Open (macOS) and "More info → Run anyway" (Windows SmartScreen).
- **Steam login:** QR code (approve in the Steam mobile app) by default, username/password + Steam Guard code as fallback.
- **Visibility:** every allowlisted user can read all synced data.
- **Cloudflare:** your account, Workers Paid ($5/month) — D1 and request limits are a non-issue.

## Open Questions

- None blocking. Revisit auto-update after the first release.

## Task Breakdown

**Phase 1 — Workspace restructure** ✅
- [x] pnpm workspace; current web app + CLI moved to `apps/web` (still runs: `pnpm dev`, `pnpm sync` from the root)
- [x] Pure domain code, item-tooltip parsing and the protobufs/GC client in `packages/core` (`@deadlock/core/...`); typecheck/lint green
- [ ] Split viewer-relative columns from shared schema; add `updated_at` → moved to Phase 4, where the cloud schema is written

**Phase 2 — Desktop shell** ✅ (except packaging config → Phase 6)
- [x] electron-vite (main / preload as CJS for the sandbox / renderer); `pnpm desktop`
- [x] Local SQLite (better-sqlite3 rebuilt for Electron + Kysely) in `userData/deadlock.sqlite`; bundled SQL migrations run on start
- [x] Typed IPC bridge (`src/shared/api.ts` contract → preload `window.api` → `ipcMain.handle`); services ported to the main process
- [x] Renderer: TanStack Router SPA with hash history, current UI, Inter bundled (offline), strict CSP, external links open in the browser
- [x] First-launch import of the old web app's database (Home → Import)

**Phase 3 — Steam in the app** ✅
- [x] Settings → Steam: QR login (steam-session, SteamClient tokens) + password/Steam Guard fallback + "use the old CLI login"; refresh token encrypted with async safeStorage
- [x] Sync engine in the main process (friends, histories with watermark, details) — budgets 40 history / 45 details per 24h in `sync_state`, 2h backoff after RateLimited, in-game skip, cloud hook for details
- [x] Scheduler (launch + 15s, every 30 min), sidebar Sync widget + Settings status/budgets, per-player Sync, "Download details" on a match, notifications for new matches, pages reload on `data:changed`

**Phase 4 — Cloud** ✅ — live at https://deadlock-cloud.studycafe-125.workers.dev (D1 `deadlock-cloud`, APAC)
- [x] Worker + D1; better-auth (D1 binding, bearer) with a Steam OpenID 2.0 plugin (assertion verified with Steam, single-use state, app-scheme redirects only); allowlist with admin bootstrap from `ADMIN_ACCOUNT_ID`
- [x] `push` (idempotent upserts + `change_log` via `changes()`), `pull?since=`, `details/lookup`, `details/get`, `me`, admin allowlist (list/add/remove + revoke sessions)
- [x] Sign-in window catches the `deadlock-tracker://auth?token=` redirect (no protocol handler needed)
- Not built: per-user friends table (not needed — friends stay local)
- Worker built on **Hono**: route groups (`/v1`, `/v1/admin`), auth/allowlist/admin middleware, `@hono/zod-validator` with the shared protocol schemas, central `{ error }` handling

**Phase 5 — Local ↔ cloud sync** ✅
- [x] Outbox filled by SQLite triggers (paused while applying cloud rows, so nothing echoes back); chunked push (≤2 MB of details per request); pull cursor; a fresh install restores everything on first sign-in
- [x] Cloud-before-Valve for match details (sync backfill and the "Download details" button)
- [x] Settings → Cloud: Sign in with Steam, status, pending uploads, admin allowlist manager
- On-demand pull per friend isn't needed: pulls bring the whole group's data

**Phase 6 — Ship**
- [ ] Packaged builds, app icon, first-run onboarding
- [ ] README for friends: install, sign in, what's shared

## Rollout / Migration Notes

- Your current data: imported once from `.wrangler/state` into the app, then pushed, so the cloud starts with your full history and every downloaded match detail.
- D1 migrations applied with `wrangler d1 migrations apply --remote` before the first app build points at the Worker.
- Allowlist seeded with your SteamID as admin via a one-off `wrangler d1 execute`.
- `apps/web` (old web app + `pnpm sync` CLI) was removed on 2026-11-01 after Phase 5. Its database was saved to `~/.deadlock-tracker/legacy-web.sqlite`, which the app's Import (Home / Settings) reads.
- Migrations: the desktop's local schema continues from today's `migrations/` (0001–0005 + local-only tables); the cloud gets its own `apps/cloud/migrations` for the shared tables + auth/allowlist. Shared row types live in `packages/core`.
