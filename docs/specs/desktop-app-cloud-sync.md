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
- **Sign in with Steam** to write to the cloud; any Steam account that signs in can read and write the shared data.
- Keep the current UI (Linear-style redesign) as the app's renderer.

## Non-Goals

- No public website. The Cloudflare Worker is an API only.
- No mobile app.
- No real-time collaboration (sync on a schedule and on demand is enough).
- Not replacing deadlock-api for player search, teammate stats, rank badges, or hero/item art (for now).
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
5. **Match details: on demand, cloud first.** Background sync only updates match histories.
   Opening a match asks the cloud for that detail (no Steam request). If no install has it,
   the page offers an explicit Steam download; the result is pushed so nobody else pays for it.
6. **Viewer-relative data stays local.** "Is my friend" and "is me" depend on who's
   looking, so `player.is_friend` / `is_self` stay local. The cloud keeps a per-user
   friends table instead.
7. **Sign in with Steam = Steam OpenID 2.0**, verified by the Worker, then a better-auth
   session (bearer token) for the app. better-auth has no built-in Steam provider (Steam
   isn't OAuth2), so this is a small custom better-auth plugin.
8. **Open sign-in.** There is no allowlist: any Steam account that completes Steam OpenID
   can read everything in the cloud and push to it. Match verification (see Trust Model) is
   what protects the shared data.

### Flows

**First launch**
1. Sign in with Steam (OpenID in an app window) → cloud session, stored in the OS keychain
   (Electron `safeStorage`).
2. Connect the Steam client for syncing: QR code (Steam mobile app) or username/password +
   Steam Guard. Only the refresh token is kept, in the keychain. The app checks that this
   account is the same SteamID as the cloud sign-in.
3. Pull from the cloud: your history, your friends' histories, every match detail
   referenced → the app is fully populated without touching Steam.

**Manual sync** (the Sync button in the sidebar/Settings, a player's Sync
button, or right after connecting Steam)
1. Skip if you're in a game (already handled by `steam-user` `playingState`).
2. Friends list + histories from the Game Coordinator (watermark logic, local request caps).
3. No match details: history only. A match's details are downloaded per match, on demand.
4. Push everything new to the cloud (outbox).

**Opening a page** reads local SQLite. If a friend's profile has nothing locally, the app
pulls it from the cloud first (when online).

## Trust Model and Match Verification

**Status: not implemented.** Sign-in is open to any Steam account, so uploaded data is untrusted
by default. None of the checks below exist yet.

### What the Worker trusts today

Authentication proves *who* uploaded, not that the data is true:

- Steam OpenID proves a real Steam account; there is no allowlist (`apps/cloud/src/auth/steam-plugin.ts`).
- `POST /v1/push` validates **shape only** (`zod` + `matchDetailSchema` in
  `apps/cloud/src/sync/push.ts`) and records `uploaded_by`. It never checks that the uploader
  played the match or that the stats came from Valve.
- `player_match` is `INSERT OR IGNORE`, so the first upload wins permanently. A poisoned row
  cannot be corrected by a later honest upload.
- `player` profile fields are last-write-wins on a client-supplied `updated_at`, so any member
  can rewrite any player's persona/avatar.
- There are no per-user rate limits.

A signed-in user can therefore inject history rows or a full fabricated scoreboard for any account.

### Threat model

| Actor | Capability |
|---|---|
| Member on the stock app | Syncs their own and their friends' histories, pushes honest rows |
| Member with a modified client or `curl` | Can POST arbitrary well-formed rows/details under their session |
| Anyone with Steam | Can sign in (no allowlist) and read or push everything |

The goal is not to stop a member lying about *their own* play — nobody can verify intent — but to
stop them **forging another player's rows or an entire match**, and to make any forgery detectable.

### What can and cannot be verified

**Cannot:** verify a history row directly against Steam. Deadlock data arrives over the Game
Coordinator (TCP + `steam-user` + a refresh token), which a Worker cannot run, and Steam does not
sign GC payloads. There is no cryptographic proof to check server-side.

**Can:** a match's canonical data lives at a deterministic, unauthenticated URL:

```
http://replay{clusterId}.valve.net/1422450/{matchId}_{metadataSalt}.meta.bz2
```

`clusterId` (`replay_group_id`) and `metadataSalt` come from GC `GetMatchMetaData` (msg 9167);
today `apps/desktop/src/main/sync/engine.ts` uses them once and discards them. If they are
persisted and pushed, the Worker can:

1. download the file from Valve (`replayN.valve.net`) — no Steam account or GC needed;
2. decompress it (`fzstd`; the pre-July-2026 bzip2 files are legacy) and decode it with the
   existing shared `decodeMetadata` (`packages/core/src/steam/metadata-file.ts`);
3. re-derive the trimmed detail with `trimMetadata` (`packages/core/.../trim-metadata.ts`, already
   pure and Worker-safe), using client-supplied names/avatars only as cosmetics;
4. store **Valve's version** and ignore the client's JSON.

The salt is not proof by itself (the client supplies it), but it is self-binding: `decodeMetadata`
rejects a file whose embedded `match_id` differs from the row's `matchId`. A client cannot host
their own file on `replayN.valve.net`, so the content is genuinely Valve's. One outbound request
per detail (~36 KB) fits comfortably within Workers subrequest limits at `PUSH_LIMITS.matchDetails`
(40 per push).

History rows then verify **transitively**: a Valve-verified detail contains every participant, so
each `player_match` row for that match can be checked field-by-field (hero, team, K/D/A, net worth,
last hits, denies, level, abandon time, plus duration/start time and `won` vs `winningTeam`). Because
details are shared through the cloud, one participant fetching a detail verifies the rows for all
ten players. Rows whose match never gets a detail can only be **corroborated** (see below).

Cosmetic fields (`name`, `avatar`) come from Steam profiles, not the metadata file. They stay
client-supplied and must never be presented as verified.

### Verification layers (planned)

1. **Ownership.** Only the subject may write its own `player` profile fields, and a
   `player_match` row is trusted only when the subject uploaded it or corroborated it. With no
   allowlist, this is the main write gate.
2. **Structural and cross-field checks.** Reject implausible values (start time outside Deadlock's
   lifetime or in the future, duration out of range, invalid team/win combinations, detail players
   not exactly two balanced teams, detail timeline inconsistent with its own players). Require a
   detail to reference a match that exists in `player_match`.
3. **Valve-verified details.** Persist `cluster_id` + `metadata_salt` with each detail, push them in
   `cloudMatchDetail`, have the Worker re-fetch and re-trim. Mark the stored row
   `verified_at`/`verifier = 'valve'`. On mismatch or download failure, keep the client row but
   leave it unverified.
4. **Row verification and corroboration.** With a verified detail, compare each row and mark it
   `verified`. Without one, count distinct Steam accounts: `self` (only the subject's own
   install), `corroborated` (≥2 distinct uploaders agree), `unverified` (single third-party
   upload).
5. **Audit and limits.** Per-user daily row/detail caps. A cron trigger (`[triggers] crons`)
   re-verifies a sample and reports quarantined rows. Admin endpoints list and resolve them.

### Data model changes (not applied yet)

| Change | Purpose |
|---|---|
| `match_detail.cluster_id`, `metadata_salt` | Locate Valve's file; both local and D1 |
| `match_detail.verified_at`, `verifier` | `'valve'` when the Worker re-derived it |
| `player_match.verified` / `source` | `verified` \| `corroborated` \| `self` \| `unverified` |
| `player_match_submission (account_id, match_id, uploader, values_json, submitted_at)` | Append-only attestations; canonical row resolved by confidence instead of `INSERT OR IGNORE` |
| `player_match_quarantine` (or a `status` column) | Holds mismatches for admin review instead of silently overwriting |

Canonical resolution order: Valve-verified detail row > corroborated > self > single upload. A
verified row always replaces an unverified one; conflicting rows are quarantined, not merged.

### Policy: store, then badge

Unverified data is still useful to the group, so it is stored and served — never silently
presented as fact:

- `pull`, `details/get` and `me` expose a `status`/`verified` field per row.
- The desktop badges verified matches ("Verified by Valve") and marks the rest as unverified;
  a verified detail replaces the unverified one when it arrives.
- Server-side validation is authoritative. The Worker stores what it re-derived from Valve, not what
  the client claimed.
- Legacy rows (pushed before salts were stored) start as `unverified_legacy`. Backfilling requires
  new `GetMatchMetaData` requests (≈50/day/account), so it can happen gradually or not at all.

### Deliberately out of scope

- A server-side Steam auditor (Container or VPS with a Steam account friended to every member) could
  answer GC history queries directly. It is the only way to confirm a row whose match has no detail,
  and it is not worth the operational cost for a friend group.
- Anti-cheat or gameplay validation. This verifies data provenance, not fair play.

## Data Model / Schema

Shared tables (local and D1, from `packages/core/migrations`):

| Table | Key | Notes |
|---|---|---|
| `player` | `account_id` | profile fields + `updated_at`. Local-only columns: `is_self`, `is_friend`, `last_viewed_at`. |
| `player_match` | `(account_id, match_id)` | immutable history rows (verification columns planned, see Trust Model) |
| `match_detail` | `match_id` | trimmed metadata JSON (~36 KB), `v`, `fetched_at`, `fetched_by` (cloud); `cluster_id`/`metadata_salt` planned |

Cloud-only (D1):

| Table | Purpose |
|---|---|
| better-auth `user`, `session`, `account`, `verification` | auth; `user.steam_id` |
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
| `GET /auth/steam/callback` | OpenID params | verifies with Steam, creates a session → 302 to `deadlock-tracker://auth?token=…` |
| `POST /v1/push` | `{ players[], playerMatches[], matchDetails[], friends[] }` (chunked, ≤ ~2 MB) | `{ accepted, skipped }` |
| `GET /v1/pull?since=<seq>&limit=` | | `{ rows by table, nextSeq, done }` |
| `POST /v1/details/lookup` | `{ matchIds[] }` | `{ have: matchId[] }` |
| `POST /v1/details/get` | `{ matchIds[] }` (≤ 50) | `{ details[] }` |

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
- `apps/cloud/src/` — `auth/` (better-auth + Steam plugin), `routes/` (push/pull/details), `server/db.ts`.

## Decisions (answered 2026-11-01)

- **Platforms:** macOS and Windows (Electron builds both).
- **Code signing:** none. Unsigned builds; the friends README explains right-click → Open (macOS) and "More info → Run anyway" (Windows SmartScreen).
- **Steam login:** QR code (approve in the Steam mobile app) by default, username/password + Steam Guard code as fallback.
- **Visibility:** any signed-in Steam user can read all synced data.
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

**Phase 3 — Steam in the app** ✅
- [x] Settings → Steam: QR login (steam-session, SteamClient tokens) + password/Steam Guard fallback + "use the old CLI login"; refresh token encrypted with async safeStorage
- [x] Sync engine in the main process (friends, histories with watermark, details) — local 24h request counters in `sync_state`, Steam's RateLimited answer is authoritative, 2h backoff, in-game skip, cloud hook for details
- [x] Manual sync only (sidebar Sync widget + Settings status/usage, per-player Sync), friend list refreshed on launch over the normal Steam connection (no GC requests), "Download from Steam" on a match, pages reload on `data:changed`

**Phase 4 — Cloud** ✅ — live at https://deadlock-cloud.studycafe-125.workers.dev (D1 `deadlock-cloud`, APAC)
- [x] Worker + D1; better-auth (D1 binding, bearer) with a Steam OpenID 2.0 plugin (assertion verified with Steam, single-use state, app-scheme redirects only)
- [x] `push` (idempotent upserts + `change_log` via `changes()`), `pull?since=`, `details/lookup`, `details/get`, `me`
- [x] Sign-in window catches the `deadlock-tracker://auth?token=` redirect (no protocol handler needed)
- Not built: per-user friends table (not needed — friends stay local)
- Worker built on **Hono**: route groups (`/v1`), auth middleware, `@hono/zod-validator` with the shared protocol schemas, central `{ error }` handling

**Phase 5 — Local ↔ cloud sync** ✅
- [x] Outbox filled by SQLite triggers (paused while applying cloud rows, so nothing echoes back); chunked push (≤2 MB of details per request); pull cursor; a fresh install restores everything on first sign-in
- [x] Match pages read local first, then the cloud; the "Download from Steam" button is the only path that spends a Steam detail request
- [x] Settings → Cloud: Sign in with Steam, status, pending uploads
- On-demand pull per friend isn't needed: pulls bring the whole group's data

**Phase 6 — Ship**
- [ ] Packaged builds, app icon, first-run onboarding
- [ ] README for friends: install, sign in, what's shared

**Phase 7 — Trust and match verification** — not started
- [ ] Ownership: only the subject writes its `player` fields; corroborate third-party `player_match` rows
- [ ] Persist `cluster_id`/`metadata_salt` on detail download; extend `cloudMatchDetail` in the protocol
- [ ] Worker re-fetches and re-trims details from `replayN.valve.net`; stores Valve's version and marks it verified
- [ ] Cross-check `player_match` against verified details; append-only submissions + corroboration for rows without details
- [ ] `verified`/`source` columns, quarantine for mismatches, `status` in pull/details responses, UI badge
- [ ] Per-user rate limits and a cron audit; legacy rows as `unverified_legacy`

## Rollout / Migration Notes

- Your current data was imported once from `.wrangler/state` and pushed, so the cloud started with your full history and every downloaded match detail.
- D1 migrations applied with `wrangler d1 migrations apply --remote` before the first app build points at the Worker.
- `apps/web` (old web app + `pnpm sync` CLI) was removed on 2026-11-01 after Phase 5. Its database was kept at `~/.deadlock-tracker/legacy-web.sqlite` as a manual backup; the app no longer imports it.
- Migrations: the desktop's local schema continues from today's `migrations/` (0001–0005 + local-only tables); the cloud gets its own `apps/cloud/migrations` for the shared tables + auth. Shared row types live in `packages/core`.
