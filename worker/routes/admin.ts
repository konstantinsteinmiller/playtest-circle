import { Hono } from 'hono'
import { STORAGE_BUDGET_BYTES } from '../../shared/rules'
import { requireAdmin } from '../auth/session'
import { creditStmt } from '../domain'
import type { AppEnv } from '../env'
import { fail, now, str } from '../lib'
import { notify } from '../notify'

export const adminRoutes = new Hono<AppEnv>()

adminRoutes.get('/overview', async (c) => {
  requireAdmin(c)
  const { results: users } = await c.env.DB.prepare(
    `SELECT id, name, email, role, credits, rep_up, rep_down, banned_at, created_at,
       (SELECT COUNT(*) FROM playtests p WHERE p.tester_id = users.id AND p.status = 'paid') AS paid_tests
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
  requireAdmin(c)
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
  const admin = requireAdmin(c)
  const id = c.req.param('id')
  if (id === admin.id) fail(409, 'cannot_ban_self')
  const { banned } = (await c.req.json()) as { banned: boolean }
  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE users SET banned_at = ? WHERE id = ?').bind(banned ? now() : null, id),
    ...(banned ? [c.env.DB.prepare("UPDATE campaigns SET hidden_at = ? WHERE owner_id = ? AND status IN ('live','paused')").bind(now(), id)] : []),
  ])
  return c.json({ ok: true })
})

adminRoutes.post('/campaigns/:id/hide', async (c) => {
  requireAdmin(c)
  const { hidden } = (await c.req.json()) as { hidden: boolean }
  await c.env.DB.prepare('UPDATE campaigns SET hidden_at = ? WHERE id = ?').bind(hidden ? now() : null, c.req.param('id')).run()
  return c.json({ ok: true })
})
