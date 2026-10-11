import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { authRoutes } from './auth/google'
import { checkOrigin, loadSession } from './auth/session'
import { runCron } from './cron'
import type { AppEnv, Env } from './env'
import { adminRoutes } from './routes/admin'
import { campaignRoutes } from './routes/campaigns'
import { gameRoutes } from './routes/games'
import { meRoutes } from './routes/me'
import { playtestRoutes } from './routes/playtests'
import { storageRoutes } from './routes/storage'

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
  }),
)

app.route('/auth', authRoutes)
app.route('/', meRoutes)
app.route('/', storageRoutes)
app.route('/games', gameRoutes)
app.route('/campaigns', campaignRoutes)
app.route('/playtests', playtestRoutes)
app.route('/admin', adminRoutes)

/** e2e only (DEV_LOGIN=1): time out one playtest's reservation and run the hourly job now. */
app.post('/dev/expire-and-cron', async (c) => {
  if (c.env.DEV_LOGIN !== '1') return c.json({ error: 'not_found' }, 404)
  const { playtestId } = (await c.req.json()) as { playtestId: string }
  await c.env.DB.prepare('UPDATE playtests SET reserved_until = 0 WHERE id = ?').bind(playtestId).run()
  await runCron(c.env)
  return c.json({ ok: true })
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
