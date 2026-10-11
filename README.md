<p align="center"><img src="public/logo.svg" width="96" alt="Play Testing Circle logo"></p>

# Play Testing Circle

*Quid pro quo playtesting.* A gated community where game developers test each other's games. Play a build while your tab is recorded, answer the dev's questions and earn **Credits**. Then spend them to get your own game tested by people who know what to look for: where you get stuck, where it gets boring, which boss is too hard or too easy.

**Open source and free.** It is built by a game dev for game devs, with no profit motive. Read it, copy it, improve it.

## How it works

1. **Sign in with Google.** It's the only way in. New members get 10 Credits.
2. **Test.** Browse open playtests in a grid or list, with hover-preview clips. Start one, and the game opens in a new tab that you share for recording. Optionally add your mic to think aloud. Mark moments while you play, then answer the questionnaire. Reach the minimum playtime and answer every required question, and the Credits are paid automatically.
3. **Post.** Create a game project with its play link, cover, screenshots, trailer and hover clip. Then launch a campaign:
   - questions from a best-practice catalog, plus up to 5 of your own
   - a playtime preset
   - the number of tests and the Credits per test (higher pay ranks higher)

   Credits are held in escrow.
4. **Review.** Every session lands in your campaign with its recording, marked moments (click to jump), ratings and comments. Rate the tester 👍/👎 to build their reputation. Recordings are deleted after 3 days. Deleting one sooner gives you +1 Credit back.

## Stack

| | |
|---|---|
| App | Vue 3 + Vite + TypeScript, Tailwind v4, Pinia, vue-router, vue-i18n |
| API | Hono on one Cloudflare Worker (it also serves the SPA), hourly cron |
| Data | Cloudflare D1 (SQLite), plain SQL migrations in `migrations/` |
| Video | `getDisplayMedia` tab capture → `MediaRecorder` (720p, ~1 Mbps) → multipart upload streamed to Backblaze B2 while you play |
| Mail | Gmail SMTP over Workers TCP sockets (free, no domain needed) |

Shared rules (payout, escrow, eviction order, question catalog) live in `shared/` and are used by both the client and the Worker.

## Develop

```sh
pnpm install
cp .dev.vars.example .dev.vars
pnpm db:migrate:local
pnpm dev            # then use "Dev login" on the landing page
pnpm test           # unit tests
pnpm test:e2e       # full playtest loop with real tab capture + accessibility checks
```

Deploying your own instance: see [docs/SETUP.md](docs/SETUP.md). Brand guide: [docs/BRAND.md](docs/BRAND.md). What's next: [roadmap.md](roadmap.md). Original plan: [implementation-plan.md](implementation-plan.md).

## License

[MIT](LICENSE)
