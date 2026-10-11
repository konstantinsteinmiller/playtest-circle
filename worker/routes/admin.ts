import { Hono } from 'hono'
import { STORAGE_BUDGET_BYTES } from '../../shared/rules'
import { creditStmt } from '../domain'
import type { AppEnv } from '../env'
import { fail, newId, now, str } from '../lib'
import { notify } from '../notify'

export const adminRoutes = new Hono<AppEnv>()

/** Constant-time string comparison via SHA-256 digests (equal length, no early exit). */
async function sameSecret(a: string, b: string) {
  const enc = new TextEncoder()
  const [x, y] = await Promise.all([crypto.subtle.digest('SHA-256', enc.encode(a)), crypto.subtle.digest('SHA-256', enc.encode(b))])
  const u = new Uint8Array(x)
  const v = new Uint8Array(y)
  let diff = 0
  for (let i = 0; i < u.length; i++) diff |= u[i] ^ v[i]
  return diff === 0
}

// The whole admin API sits behind HTTP Basic Auth (any user name, password from BASIC_AUTH_PASSWORD).
// The browser shows its own login dialog on the 401 and resends the credentials for later admin calls.
adminRoutes.use('*', async (c, next) => {
  const password = c.env.BASIC_AUTH_PASSWORD
  if (!password) fail(404, 'not_found')
  const header = c.req.header('authorization') ?? ''
  let given = ''
  if (header.startsWith('Basic ')) {
    try {
      const decoded = atob(header.slice(6))
      given = decoded.slice(decoded.indexOf(':') + 1)
    } catch {
      /* malformed */
    }
  }
  if (!given || !(await sameSecret(given, password))) {
    return c.json({ error: 'admin_auth' }, 401, { 'www-authenticate': 'Basic realm="Playtest Circle admin", charset="UTF-8"' })
  }
  await next()
})

adminRoutes.get('/overview', async (c) => {
  const { results: users } = await c.env.DB.prepare(
    `SELECT id, name, email, role, credits, rep_up, rep_down, banned_at, ban_reason, created_at,
       (SELECT COUNT(*) FROM playtests p WHERE p.tester_id = users.id AND p.status = 'paid') AS paid_tests,
       (SELECT COUNT(*) FROM user_warnings w WHERE w.user_id = users.id) AS warnings
     FROM users WHERE deleted_at IS NULL ORDER BY created_at DESC LIMIT 500`,
  ).all()
  const storage = await c.env.DB.prepare(
    `SELECT COALESCE(SUM(recording_bytes),0) AS bytes, COUNT(*) AS n FROM playtests
     WHERE recording_key IS NOT NULL AND recording_deleted_at IS NULL`,
  ).first<{ bytes: number; n: number }>()
  const { results: campaigns } = await c.env.DB.prepare(
    `SELECT c.id, c.status, c.hidden_at, c.price, c.slots_total, c.slots_paid, g.title, u.name AS owner
     FROM campaigns c JOIN games g ON g.id = c.game_id JOIN users u ON u.id = c.owner_id
     ORDER BY c.created_at DESC LIMIT 200`,
  ).all()
  return c.json({ users, campaigns, storage: { ...storage, budget: STORAGE_BUDGET_BYTES } })
})

adminRoutes.post('/users/:id/grant', async (c) => {
  const b = (await c.req.json()) as { amount: number; note?: string }
  const amount = Math.floor(Number(b.amount))
  if (!Number.isInteger(amount) || amount === 0 || Math.abs(amount) > 1000) fail(422, 'invalid_amount')
  const id = c.req.param('id')
  try {
    await c.env.DB.batch(creditStmt(c.env, id, amount, `admin_grant${b.note ? `:${str(b.note, 80)}` : ''}`, null, null))
  } catch (e) {
    if (String(e).includes('CHECK')) fail(409, 'insufficient_credits')
    throw e
  }
  if (amount > 0) await notify(c.env, id, 'credits_granted', { credits: amount }, '/wallet')
  return c.json({ ok: true })
})

adminRoutes.post('/users/:id/ban', async (c) => {
  const id = c.req.param('id')
  if (id === c.get('user')?.id) fail(409, 'cannot_ban_self')
  const { banned, reason } = (await c.req.json()) as { banned: boolean; reason?: string }
  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE users SET banned_at = ?, ban_reason = ? WHERE id = ?').bind(banned ? now() : null, banned ? str(reason ?? '', 500) : null, id),
    ...(banned
      ? [
          c.env.DB.prepare("UPDATE campaigns SET hidden_at = ? WHERE owner_id = ? AND status IN ('live','paused')").bind(now(), id),
          // Signed out everywhere at once.
          c.env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(id),
        ]
      : []),
  ])
  return c.json({ ok: true })
})

adminRoutes.post('/campaigns/:id/hide', async (c) => {
  const { hidden } = (await c.req.json()) as { hidden: boolean }
  await c.env.DB.prepare('UPDATE campaigns SET hidden_at = ? WHERE id = ?').bind(hidden ? now() : null, c.req.param('id')).run()
  return c.json({ ok: true })
})

adminRoutes.post('/users/:id/warn', async (c) => {
  const id = c.req.param('id')
  const { reason } = (await c.req.json()) as { reason?: string }
  const text = str(reason ?? '', 500, 3)
  await c.env.DB.prepare('INSERT INTO user_warnings (id, user_id, reason, created_at) VALUES (?, ?, ?, ?)').bind(newId(), id, text, now()).run()
  return c.json({ ok: true })
})
