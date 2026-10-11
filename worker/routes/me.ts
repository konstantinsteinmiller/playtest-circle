import { Hono } from 'hono'
import type { LedgerRow, Me, NotificationRow, PublicUser } from '../../shared/types'
import { endSession, requireUser } from '../auth/session'
import { deleteRecording, type PlaytestDbRow } from '../domain'
import type { AppEnv } from '../env'
import { tr } from '../i18n'
import { fail, newId, now, parseJson } from '../lib'
import { normalizeSocialUrl, SOCIAL_CLAIM } from '../../shared/rules'
import { storage } from '../storage'

export const meRoutes = new Hono<AppEnv>()

export async function ownerRecordingBytes(db: D1Database, ownerId: string): Promise<number> {
  const r = await db
    .prepare(
      `SELECT COALESCE(SUM(p.recording_bytes), 0) AS b FROM playtests p JOIN campaigns c ON c.id = p.campaign_id
       WHERE c.owner_id = ? AND p.recording_key IS NOT NULL AND p.recording_deleted_at IS NULL`,
    )
    .bind(ownerId)
    .first<{ b: number }>()
  return r?.b ?? 0
}

meRoutes.get('/me', async (c) => {
  const s = c.get('user')
  if (!s) return c.json({ user: null })
  const u = await c.env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(s.id).first<Record<string, unknown>>()
  if (!u) return c.json({ user: null })
  const me: Me = {
    id: u.id as string,
    name: u.name as string,
    email: u.email as string,
    avatarUrl: (u.avatar_url as string) ?? null,
    role: u.role as Me['role'],
    credits: u.credits as number,
    repUp: u.rep_up as number,
    repDown: u.rep_down as number,
    discordWebhook: (u.discord_webhook as string) ?? null,
    emailOptIn: !!u.email_opt_in,
    onboarded: !!u.onboarded_at,
    recordingBytes: await ownerRecordingBytes(c.env.DB, s.id),
  }
  return c.json({ user: me, banned: s.banned })
})

meRoutes.patch('/me', async (c) => {
  const u = requireUser(c)
  const body = (await c.req.json()) as { discordWebhook?: string | null; emailOptIn?: boolean; onboarded?: boolean }
  if (body.discordWebhook !== undefined) {
    const v = body.discordWebhook?.trim() || null
    if (v && !/^https:\/\/(discord|discordapp)\.com\/api\/webhooks\/\d+\/[\w-]+$/.test(v)) fail(422, 'invalid_webhook')
    await c.env.DB.prepare('UPDATE users SET discord_webhook = ? WHERE id = ?').bind(v?.replace('discordapp.com', 'discord.com') ?? null, u.id).run()
  }
  if (body.emailOptIn !== undefined) {
    await c.env.DB.prepare('UPDATE users SET email_opt_in = ? WHERE id = ?').bind(body.emailOptIn ? 1 : 0, u.id).run()
  }
  if (body.onboarded) {
    await c.env.DB.prepare('UPDATE users SET onboarded_at = COALESCE(onboarded_at, ?) WHERE id = ?').bind(now(), u.id).run()
  }
  return c.json({ ok: true })
})

meRoutes.post('/me/test-discord', async (c) => {
  const u = requireUser(c)
  const row = await c.env.DB.prepare('SELECT discord_webhook FROM users WHERE id = ?').bind(u.id).first<{ discord_webhook: string | null }>()
  if (!row?.discord_webhook) fail(422, 'no_webhook')
  const res = await fetch(row.discord_webhook, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'Playtest Circle', content: tr('notifications.discordTest') }),
  })
  return c.json({ ok: res.ok })
})

meRoutes.get('/me/ledger', async (c) => {
  const u = requireUser(c)
  const { results } = await c.env.DB.prepare('SELECT * FROM credit_ledger WHERE user_id = ? ORDER BY created_at DESC LIMIT 200')
    .bind(u.id)
    .all<{ id: string; delta: number; reason: string; ref_type: string | null; ref_id: string | null; created_at: number }>()
  const rows: LedgerRow[] = results.map((r) => ({
    id: r.id,
    delta: r.delta,
    reason: r.reason,
    refType: r.ref_type,
    refId: r.ref_id,
    createdAt: r.created_at,
  }))
  return c.json({ rows })
})

meRoutes.get('/me/social-claims', async (c) => {
  const u = requireUser(c)
  const { results } = await c.env.DB.prepare('SELECT id, url, credits, created_at FROM social_claims WHERE user_id = ? ORDER BY created_at')
    .bind(u.id)
    .all<{ id: string; url: string; credits: number; created_at: number }>()
  return c.json({
    claims: results.map((r) => ({ id: r.id, url: r.url, credits: r.credits, createdAt: r.created_at })),
    ...SOCIAL_CLAIM,
    open: now() < SOCIAL_CLAIM.until,
  })
})

meRoutes.post('/me/social-claims', async (c) => {
  const u = requireUser(c)
  const t = now()
  if (t >= SOCIAL_CLAIM.until) fail(409, 'social_ended')
  const { url } = (await c.req.json()) as { url?: unknown }
  const clean = typeof url === 'string' ? normalizeSocialUrl(url) : null
  if (!clean) fail(422, 'invalid_social_url')
  const id = newId()
  const n = SOCIAL_CLAIM.credits
  let inserted = 0
  try {
    // Insert, credit and ledger only take effect when the claim row went in (limit checked in the same statement).
    const [ins] = await c.env.DB.batch([
      c.env.DB.prepare(
        `INSERT INTO social_claims (id, user_id, url, credits, created_at)
         SELECT ?, ?, ?, ?, ? WHERE (SELECT COUNT(*) FROM social_claims WHERE user_id = ?) < ?`,
      ).bind(id, u.id, clean, n, t, u.id, SOCIAL_CLAIM.maxPerUser),
      c.env.DB.prepare('UPDATE users SET credits = credits + ? WHERE id = ? AND EXISTS (SELECT 1 FROM social_claims WHERE id = ?)').bind(n, u.id, id),
      c.env.DB.prepare(
        `INSERT INTO credit_ledger (id, user_id, delta, reason, ref_type, ref_id, created_at)
         SELECT ?, ?, ?, 'social_post', 'social_claim', ?, ? WHERE EXISTS (SELECT 1 FROM social_claims WHERE id = ?)`,
      ).bind(newId(), u.id, n, id, t, id),
    ])
    inserted = ins.meta.changes
  } catch (e) {
    if (String(e).includes('UNIQUE')) fail(409, 'social_url_used')
    throw e
  }
  if (!inserted) fail(409, 'social_max_reached')
  console.log('[social-claim]', u.id, clean)
  return c.json({ ok: true, credits: n })
})

meRoutes.get('/me/notifications', async (c) => {
  const u = requireUser(c)
  const { results } = await c.env.DB.prepare('SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 50')
    .bind(u.id)
    .all<{ id: string; type: string; payload: string; read_at: number | null; created_at: number }>()
  const rows: NotificationRow[] = results.map((r) => ({
    id: r.id,
    type: r.type,
    payload: parseJson(r.payload, {}),
    readAt: r.read_at,
    createdAt: r.created_at,
  }))
  return c.json({ rows, unread: rows.filter((r) => !r.readAt).length })
})

meRoutes.post('/me/notifications/read', async (c) => {
  const u = requireUser(c)
  await c.env.DB.prepare('UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL').bind(now(), u.id).run()
  return c.json({ ok: true })
})

/** GDPR: anonymise the account, delete every recording it is part of, cancel its live campaigns. */
meRoutes.delete('/me', async (c) => {
  const u = requireUser(c)
  const st = storage(c.env, new URL(c.req.url).origin)
  const { results } = await c.env.DB.prepare(
    `SELECT p.* FROM playtests p JOIN campaigns c ON c.id = p.campaign_id
     WHERE (p.tester_id = ?1 OR c.owner_id = ?1) AND p.recording_key IS NOT NULL AND p.recording_deleted_at IS NULL`,
  )
    .bind(u.id)
    .all<PlaytestDbRow>()
  for (const p of results) await deleteRecording(c.env, st, p, 'account_deleted')
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE campaigns SET status = 'cancelled', escrow = 0, updated_at = ?1 WHERE owner_id = ?2 AND status IN ('live','paused')").bind(now(), u.id),
    c.env.DB.prepare(
      `UPDATE users SET name = 'Deleted user', email = '', avatar_url = NULL, discord_webhook = NULL, email_opt_in = 0,
       google_sub = 'deleted:' || id, deleted_at = ? WHERE id = ?`,
    ).bind(now(), u.id),
    c.env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(u.id),
  ])
  await endSession(c)
  return c.json({ ok: true })
})

meRoutes.get('/users/:id', async (c) => {
  requireUser(c)
  const r = await c.env.DB.prepare('SELECT id, name, avatar_url, rep_up, rep_down, created_at FROM users WHERE id = ? AND deleted_at IS NULL')
    .bind(c.req.param('id'))
    .first<{ id: string; name: string; avatar_url: string | null; rep_up: number; rep_down: number; created_at: number }>()
  if (!r) fail(404, 'not_found')
  const stats = await c.env.DB.prepare(
    "SELECT COUNT(*) AS tests, COALESCE(SUM(credits_awarded),0) AS earned FROM playtests WHERE tester_id = ? AND status = 'paid'",
  )
    .bind(r.id)
    .first<{ tests: number; earned: number }>()
  const user: PublicUser = { id: r.id, name: r.name, avatarUrl: r.avatar_url, repUp: r.rep_up, repDown: r.rep_down }
  return c.json({ user, joinedAt: r.created_at, paidTests: stats?.tests ?? 0, earned: stats?.earned ?? 0 })
})
