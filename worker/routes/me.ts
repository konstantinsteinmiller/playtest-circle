import { Hono } from 'hono'
import type { LedgerRow, Me, NotificationRow, PublicUser } from '../../shared/types'
import { endSession, requireMember, requireUser } from '../auth/session'
import { deleteRecording, type PlaytestDbRow } from '../domain'
import type { AppEnv } from '../env'
import { tr } from '../i18n'
import { fail, newId, now, parseJson } from '../lib'
import { CHEAT, normalizeSocialUrl, SOCIAL_CLAIM, socialClaimTerms } from '../../shared/rules'
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
  if (now() >= CHEAT.until) await clawBackCheats(c.env.DB, s.id)
  const u = await c.env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(s.id).first<Record<string, unknown>>()
  if (!u) return c.json({ user: null })
  // The app loads /me on every visit (and an open tab pings it, see PRESENCE_PING_MS): that's what re-arms the new-campaign alert email.
  await c.env.DB.prepare('UPDATE users SET last_seen_at = ? WHERE id = ?').bind(now(), s.id).run()
  const me: Me = {
    id: u.id as string,
    name: u.name as string,
    email: u.email as string,
    avatarUrl: (u.avatar_url as string) ?? null,
    role: u.role as Me['role'],
    credits: u.credits as number,
    reserved:
      (
        await c.env.DB.prepare('SELECT COALESCE(SUM(escrow), 0) AS n FROM campaigns WHERE owner_id = ?')
          .bind(s.id)
          .first<{ n: number }>()
      )?.n ?? 0,
    repUp: u.rep_up as number,
    repDown: u.rep_down as number,
    discordWebhook: (u.discord_webhook as string) ?? null,
    emailOptIn: !!u.email_opt_in,
    campaignAlerts: !!u.campaign_alerts,
    onboarded: !!u.onboarded_at,
    recordingBytes: await ownerRecordingBytes(c.env.DB, s.id),
    cheatRemoved: (u.cheat_notice as number) ?? 0,
    guest: !!u.guest,
    warnings: (
      await c.env.DB.prepare('SELECT id, reason, created_at FROM user_warnings WHERE user_id = ? AND seen_at IS NULL ORDER BY created_at')
        .bind(s.id)
        .all<{ id: string; reason: string; created_at: number }>()
    ).results.map((w) => ({ id: w.id, reason: w.reason, createdAt: w.created_at })),
  }
  return c.json({ user: me, banned: s.banned })
})

meRoutes.patch('/me', async (c) => {
  const u = requireUser(c)
  const body = (await c.req.json()) as {
    discordWebhook?: string | null
    emailOptIn?: boolean
    campaignAlerts?: boolean
    onboarded?: boolean
    ackCheatNotice?: boolean
  }
  if (body.discordWebhook !== undefined) {
    const v = body.discordWebhook?.trim() || null
    if (v && !/^https:\/\/(discord|discordapp)\.com\/api\/webhooks\/\d+\/[\w-]+$/.test(v)) fail(422, 'invalid_webhook')
    await c.env.DB.prepare('UPDATE users SET discord_webhook = ? WHERE id = ?').bind(v?.replace('discordapp.com', 'discord.com') ?? null, u.id).run()
  }
  if (body.emailOptIn !== undefined) {
    await c.env.DB.prepare('UPDATE users SET email_opt_in = ? WHERE id = ?').bind(body.emailOptIn ? 1 : 0, u.id).run()
  }
  if (body.campaignAlerts !== undefined) {
    if (body.campaignAlerts && u.guest) fail(403, 'google_required')
    await c.env.DB.prepare('UPDATE users SET campaign_alerts = ? WHERE id = ?').bind(body.campaignAlerts ? 1 : 0, u.id).run()
  }
  if (body.ackCheatNotice) {
    await c.env.DB.prepare('UPDATE users SET cheat_notice = NULL WHERE id = ?').bind(u.id).run()
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

/**
 * After the testing period, removes whatever cheat Credits are still outstanding, as far as the balance allows
 * (Credits already locked in campaign escrow stay there). Repeats on later visits until the debt is cleared.
 */
export async function clawBackCheats(db: D1Database, userId: string) {
  const r = await db
    .prepare(
      `SELECT COALESCE(SUM(l.delta), 0) AS owed, u.credits FROM users u LEFT JOIN credit_ledger l
         ON l.user_id = u.id AND l.reason IN ('cheat', 'cheat_removed') WHERE u.id = ? GROUP BY u.id`,
    )
    .bind(userId)
    .first<{ owed: number; credits: number }>()
  const take = Math.min(r?.owed ?? 0, r?.credits ?? 0)
  if (take <= 0) return
  await db.batch([
    db.prepare('UPDATE users SET credits = credits - ?, cheat_notice = COALESCE(cheat_notice, 0) + ? WHERE id = ?').bind(take, take, userId),
    db
      .prepare("INSERT INTO credit_ledger (id, user_id, delta, reason, ref_type, ref_id, created_at) VALUES (?, ?, ?, 'cheat_removed', NULL, NULL, ?)")
      .bind(newId(), userId, -take, now()),
  ])
}

meRoutes.post('/me/warnings/:id/ack', async (c) => {
  const s = c.get('user')
  if (!s) fail(401, 'unauthenticated')
  await c.env.DB.prepare('UPDATE user_warnings SET seen_at = ? WHERE id = ? AND user_id = ? AND seen_at IS NULL').bind(now(), c.req.param('id'), s.id).run()
  return c.json({ ok: true })
})

meRoutes.post('/me/cheat', async (c) => {
  const u = requireUser(c)
  if (now() >= CHEAT.until) fail(409, 'cheat_ended')
  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE users SET credits = credits + ? WHERE id = ?').bind(CHEAT.credits, u.id),
    c.env.DB.prepare("INSERT INTO credit_ledger (id, user_id, delta, reason, ref_type, ref_id, created_at) VALUES (?, ?, ?, 'cheat', NULL, NULL, ?)")
      .bind(newId(), u.id, CHEAT.credits, now()),
  ])
  return c.json({ ok: true, credits: CHEAT.credits })
})

meRoutes.get('/me/social-claims', async (c) => {
  const u = requireUser(c)
  const { results } = await c.env.DB.prepare('SELECT id, url, credits, created_at FROM social_claims WHERE user_id = ? ORDER BY created_at')
    .bind(u.id)
    .all<{ id: string; url: string; credits: number; created_at: number }>()
  const terms = socialClaimTerms(now())
  return c.json({
    claims: results.map((r) => ({ id: r.id, url: r.url, credits: r.credits, createdAt: r.created_at })),
    ...terms,
    until: SOCIAL_CLAIM.until,
    // After the promo only a user's first post still earns.
    open: terms.promo || results.length === 0,
  })
})

meRoutes.post('/me/social-claims', async (c) => {
  const u = requireMember(c)
  const t = now()
  const terms = socialClaimTerms(t)
  const { url } = (await c.req.json()) as { url?: unknown }
  const clean = typeof url === 'string' ? normalizeSocialUrl(url) : null
  if (!clean) fail(422, 'invalid_social_url')
  const id = newId()
  const n = terms.credits
  let inserted = 0
  try {
    // Insert, credit and ledger only take effect when the claim row went in (limit checked in the same statement).
    const [ins] = await c.env.DB.batch([
      c.env.DB.prepare(
        `INSERT INTO social_claims (id, user_id, url, credits, created_at)
         SELECT ?, ?, ?, ?, ? WHERE (SELECT COUNT(*) FROM social_claims WHERE user_id = ?) < ?`,
      ).bind(id, u.id, clean, n, t, u.id, terms.maxPerUser),
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
