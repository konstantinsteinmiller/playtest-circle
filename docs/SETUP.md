# Setup & deployment runbook

Everything runs on free tiers: Cloudflare Workers + D1 (app, API, database), Backblaze B2 (recordings and game media) and Gmail SMTP (notification email).

## 1. Local development

```sh
pnpm install
cp .dev.vars.example .dev.vars        # only SESSION_SECRET is needed locally
pnpm db:migrate:local
pnpm dev                              # http://localhost:5173 — "Dev login" on the landing page
```

`pnpm dev` runs the Worker in the `dev` environment from `wrangler.jsonc`: local D1, a local R2 bucket in place of B2, dev login on, email off. No external account is needed.

Tests:

```sh
pnpm test        # unit tests (economy rules, questionnaire, mail encoding)
pnpm test:e2e    # Playwright in system Chrome: full playtest loop with real tab capture + axe in both themes
```

## 2. Google sign-in (OAuth client)

1. <https://console.cloud.google.com/> → new project **playtest-circle**.
2. *APIs & Services → OAuth consent screen*:
   - User type **External**.
   - App name *Playtest Circle*, support email, logo `public/logo.svg` (exported as PNG).
   - Scopes: `openid`, `email`, `profile` only. These are non-sensitive, so no Google verification is needed.
   - **Publish app** → *In production*.
3. *Credentials → Create credentials → OAuth client ID → Web application*. Authorised redirect URIs:
   - `http://localhost:5173/api/auth/google/callback`
   - `https://playtest-circle.<your-subdomain>.workers.dev/api/auth/google/callback`
4. Store the credentials:
   ```sh
   npx wrangler secret put GOOGLE_CLIENT_ID
   npx wrangler secret put GOOGLE_CLIENT_SECRET
   ```
   For local Google login, put the same two values into `.dev.vars`.

## 3. Backblaze B2 (recordings + media)

The free tier gives 10 GB of storage and free egress up to 3× the stored amount. That fits about 50 active devs at the recording settings in `shared/rules.ts` (720p, ~8 MB per minute).

1. Create an account at <https://www.backblaze.com/b2/>. No card is needed.
2. Create a bucket named **playtest-circle**, set to **Private**.
3. Create an application key restricted to that bucket with read + write. Note its `keyID`, `applicationKey` and the S3 endpoint (e.g. `https://s3.eu-central-003.backblazeb2.com`).
4. Lifecycle rule (a backstop: the Worker's hourly cron already deletes recordings after 3 days):
   - prefix `recordings/`
   - *days from uploading to hiding*: 3
   - *days from hiding to deleting*: 1
5. CORS rules, so the browser can upload directly. Set them with the B2 CLI or the API:
   ```json
   [{
     "corsRuleName": "playtest-app",
     "allowedOrigins": ["https://playtest-circle.<your-subdomain>.workers.dev", "http://localhost:5173"],
     "allowedOperations": ["s3_put", "s3_get", "s3_head"],
     "allowedHeaders": ["*"],
     "exposeHeaders": ["ETag"],
     "maxAgeSeconds": 3600
   }]
   ```
   `exposeHeaders: ETag` is required: the recorder needs each part's ETag to finish the multipart upload.
6. Set `B2_ENDPOINT` and `B2_REGION` in `wrangler.jsonc` (top-level `vars`). Then store the keys:
   ```sh
   npx wrangler secret put B2_KEY_ID
   npx wrangler secret put B2_APP_KEY
   ```

## 4. Email notifications (Gmail SMTP)

Devs get an email for every finished playtest by default, sent to their Google sign-in address. They can turn it off in Settings. Without a custom domain, the free way to send is Gmail SMTP with an **app password** from the operator's Google account. The limit is about 500 mails/day.

1. Turn on 2-Step Verification for the sending Google account.
2. <https://myaccount.google.com/apppasswords> → create an app password named "Playtest Circle".
3. Store it:
   ```sh
   npx wrangler secret put SMTP_USER     # e.g. hyperg8.studio@gmail.com
   npx wrangler secret put SMTP_PASS     # the 16-character app password
   ```

Once a domain exists, switch `MAIL_DRIVER` to `resend` and set `RESEND_API_KEY` and `MAIL_FROM`.

## 5. Cloudflare deploy

```sh
npx wrangler login
npx wrangler d1 create playtest-circle          # paste the database_id into wrangler.jsonc (top level + envs)
pnpm db:migrate:remote
npx wrangler secret put SESSION_SECRET          # any long random string
pnpm run deploy
```

Then set `APP_URL` in `wrangler.jsonc` to the deployed URL and deploy again. The hourly cron does the following:
- expires stale reservations
- deletes recordings after 3 days
- sends the 24 h warning
- enforces the global storage budget: watched recordings go first (oldest first), then the oldest unwatched ones

## 6. Admin

Every email in `ADMIN_EMAILS` gets the Admin page. From there you can grant Credits (for example to seed the first devs), ban members and hide campaigns.

## Admin panel

The admin panel at `/admin` is protected with HTTP Basic Auth (any user name). Set the password locally in `.dev.vars` as `BASIC_AUTH_PASSWORD=...` and in production with `npx wrangler secret put BASIC_AUTH_PASSWORD`. While it is unset, the admin API answers 404.
