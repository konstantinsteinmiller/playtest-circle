# Playtest Circle — implementation plan

> *Quid pro quo playtesting.* An open-source, gated community where game devs earn **Credits** by playtesting each other's games and spend them to get their own games tested.

## Context

Players who play for fun give shallow feedback. Devs need answers like: where do you get stuck, where does it get boring, which boss is too hard or too easy. This platform trades expertise for expertise. Devs post a **campaign** for their game with a questionnaire, a playtime target and a Credit price per test. Other devs play the game in a recorded tab, answer the questionnaire and earn the Credits. The repo is currently empty. This plan builds v1 from scratch, sized for about 50 devs on free tiers only.

### Decisions already made with the user

| Topic | Decision |
|---|---|
| Recording storage | **Backblaze B2** (10 GB free, private bucket, S3 API) |
| Game during playtest | Opens in a **new tab**. Our tab records it via tab capture and holds the timer, notes and questionnaire |
| Credit payout | **Fully automatic**, threshold-based, no disputes |
| Bootstrap | **Small welcome grant** for every new user |
| v1 extras | Mic think-aloud, timestamped notes, tester reputation, Discord/email alerts |
| Questions | Best-practice catalog + up to 5 custom questions |
| i18n | English only, through vue-i18n (`en.json`) so adding languages later is just a file |
| Repo / hosting | New public GitHub repo `playtest-circle`, MIT license, free Cloudflare subdomain |

## Architecture

```
Browser (Vue 3 SPA) ──/api──▶ Cloudflare Worker (Hono)  ──▶ D1 (SQLite)
       │                         │  cron (hourly)          users, games, campaigns,
       │                         │                         playtests, answers, ledger…
       └── presigned PUT/GET ───▶ Backblaze B2 (private bucket)
                                    recordings/  (lifecycle: hide 3 d, delete +1 d)
                                    media/       (screenshots, hover clips; permanent)
```

- **One Worker with static assets** serves both the SPA and `/api/*`. Pages Functions can't run cron triggers, and the 3-day cleanup needs one. The URL is `playtest-circle.<account>.workers.dev`, equally free; a custom domain can be added later.
- **Frontend:** Vue 3 + Vite + TypeScript, HTML templates (as requested), Tailwind v4, vue-router, Pinia, vue-i18n, VueUse. pnpm.
- **Backend:** Hono on Workers, D1 with plain SQL migrations (`wrangler d1 migrations`), and `aws4fetch` to sign B2 S3 requests. No ORM.
- **Shared code** in `shared/`: TypeScript types, the question catalog, payout rules and priority presets. Client and Worker import the same rules.
- **Storage driver interface** with two implementations: `B2Driver` (prod) and `LocalDriver` (dev/e2e, a local R2 binding behind Worker upload routes). The whole app runs offline in `wrangler dev`.

### Repo layout

```
src/        Vue app (pages/, components/, composables/, stores/, i18n/en.json, styles/)
worker/     Hono app (routes/, auth/, storage/, cron.ts, payout.ts)
shared/     questions.ts, rules.ts, types.ts
migrations/ 0001_init.sql …
e2e/        Playwright specs (fake auth + fake media)
public/     logo.svg, favicon, og-image
docs/       BRAND.md, SETUP.md (Google OAuth, B2, Cloudflare runbook)
implementation-plan.md, roadmap.md, README.md, LICENSE (MIT)
```

## Auth — Google SSO only

- OAuth 2.0 authorization-code flow implemented in the Worker: `/api/auth/google/start` → Google → `/api/auth/google/callback`. Uses the `state` + PKCE pair, verifies the ID token, upserts the user by `google_sub`.
- Session: random 256-bit token in an `HttpOnly; Secure; SameSite=Lax` cookie. Only its SHA-256 is stored in `sessions` (30-day sliding expiry). Mutating routes also check `Origin`.
- First login grants the **welcome grant (10 Credits)** as a ledger row. Users with role `admin` (you, by email in env `ADMIN_EMAILS`) get an admin panel: grant Credits, ban, hide a campaign.
- Dev/e2e only: `/api/auth/dev-login`, enabled only when `DEV_LOGIN=1` and never in production config.
- **Google Cloud setup (needs your login):** I launch a headed Chrome on a dedicated profile, you sign in once with the Hyperg8 account, and I then drive it over CDP. Steps:
  1. Create the project.
  2. Set up the OAuth consent screen as External with scopes `openid email profile`. These are non-sensitive, so no verification is needed, and the screen is published to production.
  3. Create a Web client with redirect URIs for localhost:8787 and the workers.dev URL.

  The client ID and secret are stored only via `wrangler secret put`.

## Credits economy (`shared/rules.ts`, unit-tested)

- **Ledger-first:** every change is a `credit_ledger` row. `users.credits` is a cached balance updated in the same D1 `batch()`, and a balance can never go below 0.
- **Price per test** is chosen by the dev, from 5 to 100 Credits. Presets: *Whenever* 5 · *Normal* 10 · *Soon* 20 · *Urgent* 40. Browse sorts by price by default, so higher pay surfaces first.
- **Publishing a campaign** moves `slots × price` from the dev's balance into campaign escrow (a ledger row). Cancelling or completing refunds unused escrow.
- **Starting a test reserves a slot** for `max(60 min, 3 × minMinutes)`. An expired reservation frees the slot again (cron). Rules: one test per tester per campaign, and no testing your own games.
- **Automatic payout at submit.** The tester gets `price` Credits when all of these hold:
  1. The recording upload completed and its size is plausible for the duration.
  2. Server-measured active time (start → stop, cross-checked with the recorder's own duration) is at least the campaign's `minMinutes`.
  3. Every required question is answered (a 1–5 value, or N/A where allowed).

  Otherwise the feedback is still delivered and the status shows why there was no payout (`quit_early` / `incomplete`). The slot goes back to the pool and the escrow stays with the campaign.
- **Playtime presets:** *Quick 3–5 min* (min 3) · *Standard ~10 min* (min 7) · *Deep 20+ min* (min 15) · *Open-ended, as long as you want* (min 5).
- **Reputation:** the dev rates each test 👍 or 👎 with an optional note. It doesn't change payout (payout is fully automatic). It feeds the tester's public reputation score, and a campaign can optionally require a minimum reputation.

## Questionnaire

- **Catalog** (`shared/questions.ts`), with stable IDs and categories:
  - Controls & feel
  - First 3 minutes / onboarding
  - Progression (short-term and long-term)
  - Difficulty & challenge
  - Bosses (too hard / too easy)
  - Pacing & boredom ("where would you drop out?")
  - Getting stuck
  - UI readability
  - Audio
  - Visuals
  - Performance
  - Overall

  Each entry carries a short "what to look for" hint for testers.
- **Answer types:**
  - `scale5`: 1 Broken · 2 Weak · 3 It's okay · 4 Good · 5 Perfect
  - `feeling5`: Doesn't apply at all · Barely applies · Somehow applies · Mostly applies · Fully applies
  - `yesno`
  - `text`

  Every non-text question also has an optional free-text field and, where it makes sense, an "N/A" option.
- **Always appended:**
  - "Did you stop before the target playtime? Why?" (required when below the minimum)
  - "Where did you get stuck?"
  - Overall rating
- Up to 5 custom questions per campaign, using the same answer types. The questions are snapshotted into the campaign at publish, so they're immutable and the results stay comparable.

## Playtest flow (the "cockpit", `/play/:playtestId`)

1. **Gate:** desktop Chrome, Edge or Opera with `getDisplayMedia` tab capture. Other browsers get a friendly message explaining why.
2. **Briefing:** game, build instructions, target playtime, questions to keep in mind, the recording consent text and an optional mic toggle.
3. **Open game.** A button opens the game URL in a new tab. It is a separate click, because the popup consumes user activation.
4. **Start recording.** Calls `getDisplayMedia({ video: { displaySurface: 'browser' }, audio: true, selfBrowserSurface: 'exclude', surfaceSwitching: 'include' })`. The tester picks the **game tab**, so the whole tab viewport with all UI is captured, not just a canvas. If `track.getSettings().displaySurface !== 'browser'`, they are asked to pick the tab instead. Optional mic audio is mixed with the tab audio through `AudioContext`.
5. **Recording settings:** max 1280×720 at 30 fps, ~1 Mbps video + 64 kbps Opus, about 8 MB/min.
   - The container is MP4/H.264 where `MediaRecorder` supports it (Chrome ≥ 126), otherwise WebM VP9/VP8.
   - Chunks are buffered to ≥ 5 MB and streamed **during play** as S3 multipart parts to presigned part URLs, with retry and backoff, so a crash loses at most one part.
6. **While playing**, our tab shows:
   - a timer with min/target markers
   - **Mark moment + note**, saved as `offset_ms`
   - a mic level meter
   - a big "Stop & give feedback" button

   Ending the share (Chrome's "Stop sharing") does the same as Stop.
7. **Questionnaire:** all questions, each with a 1–5/feeling scale or N/A plus free text. Below the minimum time, the quit-reason question becomes required.
8. **Submit:** completes the multipart upload, the server evaluates payout, and a result screen shows the Credits earned (or why none were) and suggests the next campaign.

**Spike S1 (first task in that milestone):** check that the recordings are seekable in `<video>` with jump-to-note.
- Fragmented MP4 seeks fine in Chrome.
- WebM from MediaRecorder has no cues. Mitigation: the player seeks via the known duration from the DB, and the WebM path keeps the moov/cues issue documented.

If seeking fails, fall back to uploading 60-second segment objects and playing them as a playlist.

## Studio (game-dev side)

- **Onboarding tutorial** (`/how-it-works`), shown once after first login and always reachable. It has 4 illustrated steps (Earn → Create game → Launch campaign → Review) and states "Submitting takes about 5 minutes."
- **Game project stepper:**
  1. Basics: title, pitch, genre tags
  2. Play link: itch, Wavedash or custom URL, with a host type and an "MMO/needs account" note field
  3. Media: cover, up to 8 screenshots (resized to WebP client-side, ≤ 2 MB each), a trailer link (YouTube/Vimeo, shown on the detail page) and an optional short **hover clip** (≤ 30 s / 20 MB mp4/webm) that autoplays muted on cards
  4. Review
- **Campaign stepper:**
  1. Pick game + build URL/version + instructions for testers
  2. Questions (catalog picker by category + custom)
  3. Playtime preset
  4. Slots × price, with priority presets and a live escrow cost vs balance
  5. Review & publish

  Every step shows a progress indicator and an "about 5 min" estimate.
- **Campaign results:**
  - A table of playtests: tester (with reputation), played time, answered x/y, Credit status (paid / quit early / incomplete / in progress), recording expiry countdown.
  - Per-question aggregates: average, distribution bars and all text answers.
  - **Playtest review page:** video player, notes timeline (click to jump), answers, rate 👍/👎, **"Reviewed — delete recording"**.
- **Keeping storage low:**
  - Recordings are deleted after 3 days by cron, backed by a B2 lifecycle rule (a backstop on the `recordings/` prefix).
  - Each dev has a 1.5 GB active-recording quota with a meter in the studio. A dev over quota can't publish new campaigns or add slots until they delete recordings.
  - Deleting a recording within 24 h of submit refunds **+1 Credit** ("tidy bonus"), capped at one per playtest.
  - A 24 h-before-expiry alert goes out (Discord / in-app / email).
  - **Storage pressure (added during implementation, on request):** all recordings together stay under a global budget (`STORAGE_BUDGET_BYTES`, 9 GB of the 10 GB B2 free tier). Before every new recording, and hourly, the oldest recordings the dev **already watched** are deleted first, then the oldest remaining ones (`pickEvictions` in `shared/rules.ts`, unit-tested). "Watched" means the dev pressed play on the review page (`recording_viewed_at`). Affected devs get a notification.

## Browse (tester side)

- `/browse` has a **grid ↔ list** toggle (remembered per viewer) and filters (genre, playtime preset, price range, host). Sort options: highest pay, newest, fewest slots left.
- It hides own campaigns, already-tested ones and full ones.
- Cards: cover, title, pitch, Credit reward pill, playtime chip, slots left. **Hovering autoplays the muted hover clip**; on touch devices it's tap-to-preview.
- Detail page `/c/:id`: gallery, embedded trailer, questions preview ("what you'll be asked"), instructions, reward, **Start playtest**.

## Notifications

- An in-app bell (`notifications` table, polled every 60 s while the tab is visible).
- **Discord:** each user can paste their own webhook URL in Settings, which is free and needs no infrastructure. Events: new playtest received, recording expires in 24 h, campaign completed, escrow refunded.
- **Email (revised during implementation, on request):** on by default for every finished playtest, sent to the dev's Google sign-in address. Devs can switch it off in Settings and check results manually. It is sent for free without a domain via **Gmail SMTP with an app password** (Workers TCP sockets, port 465, ~500/day), through `MAIL_DRIVER=gmail`. Resend stays available as `MAIL_DRIVER=resend` once a domain exists.

## Hourly cron (`worker/cron.ts`)

- Expire stale reservations and abort their multipart uploads.
- Delete recordings older than 72 h, mark them `recording_deleted_at` and send 24 h warnings.
- Auto-complete campaigns whose slots are filled and refund leftover escrow.

## D1 schema (migrations/0001_init.sql)

| Table | Columns |
|---|---|
| `users` | id, google_sub (unique), email, name, avatar_url, role, credits, rep_up, rep_down, discord_webhook, email_opt_in, theme, onboarded_at, banned_at, created_at |
| `sessions` | token_hash, user_id, expires_at |
| `credit_ledger` | id, user_id, delta, reason, ref_type, ref_id, created_at |
| `games` | id, owner_id, title, pitch, description, tags (json), play_url, host, trailer_url, cover_key, hover_clip_key, screenshots (json), archived_at, timestamps |
| `campaigns` | id, game_id, owner_id, build_label, build_url, instructions, playtime_preset, min_minutes, slots_total, price, escrow, min_reputation, questions (json snapshot), status (draft/live/paused/completed/cancelled), published_at, timestamps |
| `playtests` | id, campaign_id, tester_id, status (reserved/recording/submitted/paid/no_payout/expired), reserved_until, started_at, stopped_at, active_ms, recorder_ms, used_mic, upload_id, recording_key, recording_bytes, recording_mime, recording_expires_at, recording_deleted_at, answered, required, credits_awarded, payout_reason, dev_rating, dev_rating_note, submitted_at. Unique (campaign_id, tester_id) |
| `answers` | playtest_id, question_id, value, na, text |
| `notes` | id, playtest_id, offset_ms, text |
| `notifications` | id, user_id, type, payload (json), read_at, created_at |

Indexes cover the browse query (status, price DESC, published_at) and per-owner lists.

## Brand & UI

- **Logo** (SVG, also favicon + OG image): two arrows chasing each other in a circle (the quid-pro-quo exchange), with a play triangle in the centre. Wordmark: **Playtest Circle**, subtitle *Quid pro quo playtesting*.
- **Palette:** high contrast, WCAG AA minimum and AAA for body text. Near-black `#0B0B10` / off-white `#F7F7F2`, primary electric lime `#C6FF3D`, accent hot magenta `#FF3DA5`, info cyan `#3DD9FF`. Status colours are always paired with an icon and label, never colour alone.
- **Type:** Space Grotesk for display, Inter for UI. Large hit targets and visible focus rings.
- **Theme:** dark by default, with a Light / Dark / System toggle in the header and an inline pre-paint script so there's no flash. Colours are CSS tokens on `:root` with a `[data-theme]` override, mapped into Tailwind v4 `@theme`.
- **Style:** fresh, slightly "game-y" (chunky cards, subtle glow on the lime CTA, motion that respects `prefers-reduced-motion`).
- `docs/BRAND.md`: name, tagline, voice ("dev-to-dev, direct, generous"), logo usage, colour tokens with contrast ratios, type scale.
- **Footer on every page:** "Playtest Circle is open source and free — built by a game dev for game devs, no profit motive." Plus links to GitHub, Roadmap, Privacy, Terms and Imprint.
- **Legal pages:** Privacy (what's recorded, who can see it: only the campaign owner + the tester; 3-day deletion; account deletion), Terms (no NSFW without a tag, no malware links) and **Imprint**. An Impressum is legally required in Germany, so it's a placeholder you fill in.
- **Account deletion** in Settings (GDPR): anonymises the user and deletes their recordings.
- All user-facing copy goes through vue-i18n `src/i18n/en.json`, with aria-labels included.

## roadmap.md (created now)

- **Buy Credits** (Stripe or PayPal Checkout). Purchased Credits fund playtests and flow to testers.
- **PayPal payout** for testers who accumulate Credits above a threshold (KYC/tax notes).
- Custom domain + transactional email.
- More languages (de first).
- Team/studio accounts.
- Steam-key / downloadable-build campaigns (desktop capture instead of tab capture).
- Per-campaign NDA toggle.
- Heatmap of "Mark moment" timestamps across testers.
- Clip export of a recording moment.
- Public tester leaderboard.
- Dispute flow (if fully automatic payout gets abused).
- IndexedDB crash-resume for recordings.

## Milestones (each ends green: typecheck + unit + e2e)

1. **Scaffold:** `git init`, pnpm + Vite + Vue + TS + Tailwind v4 + router/Pinia/i18n, Worker + Hono + wrangler config, D1 migration, MIT LICENSE, README, `implementation-plan.md` (this file), `roadmap.md`, `docs/BRAND.md`, logo/favicon, theme system, app shell + footer, legal pages.
2. **Auth:** Google OAuth flow, sessions, `/api/me`, welcome grant, dev-login for tests, route guards, landing page + onboarding tutorial.
3. **Games & media:** game stepper, storage driver (Local + B2), presigned media upload, client-side image resize.
4. **Campaigns & Credits:** catalog/custom question picker, campaign stepper, escrow ledger, wallet page, rules unit tests.
5. **Browse:** grid/list, filters, hover clips, detail page.
6. **Playtest cockpit:** Spike S1, then capture + mic mix + multipart streaming upload, notes, questionnaire, payout evaluation, result screen.
7. **Results & review:** results table, aggregates, video review with notes timeline, rating/reputation, delete + tidy bonus, quota meter.
8. **Notifications + cron:** in-app bell, Discord webhooks, Resend behind a flag, hourly cron, admin panel.
9. **External setup & deploy:**
   - Google OAuth client via browser.
   - B2 bucket, app key, CORS and lifecycle rules via the B2 API once you've created the account.
   - D1 create, secrets, `wrangler deploy`.
   - GitHub repo: `gh` isn't installed yet, so `winget install GitHub.cli` + `gh auth login` (or you create the repo by hand).

## Verification

- **Vitest:**
  - payout rules
  - escrow/refund/tidy-bonus ledger math, including "never negative"
  - question snapshot validation
  - session/token hashing
  - Worker routes via Hono `app.request()` against a Miniflare D1
- **Playwright e2e** (Chrome, private `--user-data-dir`, random port, title-checked server). Chrome flags `--auto-accept-this-tab-capture --use-fake-device-for-media-stream --use-fake-ui-for-media-stream` drive a real tab capture. Two dev-login users run the full loop: dev publishes a campaign → tester browses, opens the game tab (a local fixture game page), records 3+ min of virtual time (short `minMinutes` override in test env), adds a note, submits → Credits paid → dev sees the row, plays the video, jumps to the note, rates it and deletes the recording.
- **`@axe-core/playwright`** on every page in both themes, with zero serious violations allowed (high-contrast requirement).
- **Manual check against the deployed URL:** real Google login, a real B2 upload/playback, and the lifecycle rule visible in B2.
- All test runs go through the worker-budget wrapper. Every dev server and browser I start gets stopped when the check finishes.
