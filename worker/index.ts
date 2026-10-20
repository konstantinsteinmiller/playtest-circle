import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { authRoutes } from './auth/google'
import { checkOrigin, loadSession } from './auth/session'
import { runCron } from './cron'
import type { AppEnv, Env } from './env'
import { adminRoutes } from './routes/admin'
import { campaignRoutes } from './routes/campaigns'
import { gameRoutes } from './routes/games'
import { clawBackCheats, meRoutes } from './routes/me'
import { playtestRoutes } from './routes/playtests'
import { storageRoutes } from './routes/storage'
import { ONLINE_WINDOW_MS } from '../shared/rules'
import { now } from './lib'

export const app = new Hono<AppEnv>().basePath('/api')

app.use('*', async (c, next) => {
  await next()
  c.header('x-content-type-options', 'nosniff')
  c.header('referrer-policy', 'strict-origin-when-cross-origin')
  if (!c.res.headers.get('cache-control')) c.header('cache-control', 'no-store')
})
app.use('*', checkOrigin)
app.use('*', loadSession)

app.get('/config', (c) =>
  c.json({
    githubUrl: c.env.GITHUB_URL,
    devLogin: c.env.DEV_LOGIN === '1',
    googleConfigured: !!c.env.GOOGLE_CLIENT_ID,
    // Where recordings upload to, so the client can check that a blocker doesn't stop it.
    storageOrigin: c.env.STORAGE_DRIVER === 'b2' ? new URL(c.env.B2_ENDPOINT).origin : null,
  }),
)

/**
 * Public counter: people who did something (added a game, commented or took a playtest), guests included,
 * and how many of them had the app open in the last hour.
 */
app.get('/stats', async (c) => {
  const r = await c.env.DB.prepare(
    `SELECT COUNT(*) AS active, COALESCE(SUM(u.last_seen_at > ?), 0) AS online FROM users u
     WHERE u.deleted_at IS NULL AND u.banned_at IS NULL AND (
       EXISTS (SELECT 1 FROM games g WHERE g.owner_id = u.id)
       OR EXISTS (SELECT 1 FROM game_comments gc WHERE gc.user_id = u.id AND gc.deleted_at IS NULL)
       OR EXISTS (SELECT 1 FROM playtests p WHERE p.tester_id = u.id))`,
  )
    .bind(now() - ONLINE_WINDOW_MS)
    .first<{ active: number; online: number }>()
  c.header('cache-control', 'public, max-age=60')
  return c.json({ active: r?.active ?? 0, online: r?.online ?? 0 })
})

app.route('/auth', authRoutes)
app.route('/', meRoutes)
app.route('/', storageRoutes)
app.route('/games', gameRoutes)
app.route('/campaigns', campaignRoutes)
app.route('/playtests', playtestRoutes)
app.route('/admin', adminRoutes)

/** e2e only (DEV_LOGIN=1): run the after-testing-period cheat clawback for the signed-in user now. */
app.post('/dev/clawback', async (c) => {
  if (c.env.DEV_LOGIN !== '1' || !c.get('user')) return c.json({ error: 'not_found' }, 404)
  await clawBackCheats(c.env.DB, c.get('user')!.id)
  return c.json({ ok: true })
})

/** e2e only (DEV_LOGIN=1): time out one playtest's reservation (or age one campaign) and run the hourly job now. */
app.post('/dev/expire-and-cron', async (c) => {
  if (c.env.DEV_LOGIN !== '1') return c.json({ error: 'not_found' }, 404)
  const { playtestId, campaignId } = (await c.req.json()) as { playtestId?: string; campaignId?: string }
  if (playtestId) await c.env.DB.prepare('UPDATE playtests SET reserved_until = 0 WHERE id = ?').bind(playtestId).run()
  if (campaignId) await c.env.DB.prepare('UPDATE campaigns SET published_at = 0 WHERE id = ?').bind(campaignId).run()
  await runCron(c.env)
  return c.json({ ok: true })
})

/** e2e only (DEV_LOGIN=1): a user's alert-email state (new campaigns, comments), and optionally pretend the last alert was a day ago. */
app.post('/dev/campaign-alert', async (c) => {
  if (c.env.DEV_LOGIN !== '1') return c.json({ error: 'not_found' }, 404)
  const { email, ageDay } = (await c.req.json()) as { email: string; ageDay?: boolean }
  if (ageDay) {
    await c.env.DB.prepare('UPDATE users SET campaign_alert_at = campaign_alert_at - 90000000, last_seen_at = last_seen_at - 90000000 WHERE email = ?')
      .bind(email)
      .run()
  }
  const row = await c.env.DB.prepare('SELECT campaign_alert_at, last_seen_at, comment_mail_at FROM users WHERE email = ?')
    .bind(email)
    .first<{ campaign_alert_at: number | null; last_seen_at: number | null; comment_mail_at: number | null }>()
  return c.json({ alertAt: row?.campaign_alert_at ?? null, seenAt: row?.last_seen_at ?? null, commentMailAt: row?.comment_mail_at ?? null })
})

app.notFound((c) => c.json({ error: 'not_found' }, 404))
app.onError((err, c) => {
  if (err instanceof HTTPException) return c.json({ error: err.message }, err.status)
  console.error('[api]', err)
  return c.json({ error: 'internal_error' }, 500)
})

export default {
  fetch: app.fetch,
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(runCron(env))
  },
} satisfies ExportedHandler<Env>
