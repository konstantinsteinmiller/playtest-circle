import { Hono, type Context } from 'hono'
import { buildSnapshot, type CampaignQuestion } from '../../shared/questions'
import {
  RECORDING_QUOTA_BYTES,
  escrowFor,
  playtimePreset,
  reputationScore,
  reservationMs,
  validatePrice,
  validateSlots,
} from '../../shared/rules'
import type { CampaignInput, PlaytestStatus } from '../../shared/types'
import { requireUser } from '../auth/session'
import {
  CAMPAIGN_FROM,
  CAMPAIGN_SELECT,
  PENDING_STATUSES,
  creditStmt,
  loadCampaign,
  mapCampaignCard,
  mapCampaignDetail,
  mapPlaytestRow,
  type CampaignRow,
  type PlaytestDbRow,
} from '../domain'
import type { AppEnv } from '../env'
import { fail, httpUrl, newId, now, parseJson, str } from '../lib'
import { ownerRecordingBytes } from './me'

export const campaignRoutes = new Hono<AppEnv>()

const SORTS: Record<string, string> = {
  pay: 'c.price DESC, c.published_at DESC',
  new: 'c.published_at DESC',
  slots: '(c.slots_total - c.slots_paid - pending) ASC, c.price DESC',
}

/** Browse: live campaigns the viewer can still take. */
campaignRoutes.get('/', async (c) => {
  const u = requireUser(c)
  const q = c.req.query()
  const where = [
    "c.status = 'live'",
    'c.hidden_at IS NULL',
    'c.owner_id != ?1',
    'NOT EXISTS (SELECT 1 FROM playtests mp WHERE mp.campaign_id = c.id AND mp.tester_id = ?1)',
  ]
  const params: (string | number)[] = [u.id]
  const bind = (v: string | number) => {
    params.push(v)
    return `?${params.length}`
  }
  if (q.preset && playtimePreset(q.preset)) where.push(`c.playtime_preset = ${bind(q.preset)}`)
  if (q.host) where.push(`g.host = ${bind(q.host)}`)
  if (q.minPrice && Number(q.minPrice) > 0) where.push(`c.price >= ${bind(Number(q.minPrice))}`)
  if (q.tag) where.push(`g.tags LIKE ${bind(`%"${q.tag.toLowerCase().replace(/["%_]/g, '')}"%`)}`)
  if (q.q) {
    const term = `%${q.q.toLowerCase().replace(/[%_]/g, '')}%`
    where.push(`(lower(g.title) LIKE ${bind(term)} OR lower(g.pitch) LIKE ?${params.length})`)
  }
  const order = SORTS[q.sort ?? 'pay'] ?? SORTS.pay
  const { results } = await c.env.DB.prepare(
    `SELECT ${CAMPAIGN_SELECT} ${CAMPAIGN_FROM} WHERE ${where.join(' AND ')} ORDER BY ${order} LIMIT 200`,
  )
    .bind(...params)
    .all<CampaignRow>()
  const cards = results.map(mapCampaignCard).filter((x) => x.slotsLeft > 0)
  const tags = [...new Set(cards.flatMap((x) => x.game.tags))].sort()
  return c.json({ campaigns: cards, tags })
})

campaignRoutes.get('/mine', async (c) => {
  const u = requireUser(c)
  const { results } = await c.env.DB.prepare(
    `SELECT ${CAMPAIGN_SELECT},
       (SELECT COUNT(*) FROM playtests p WHERE p.campaign_id = c.id AND p.submitted_at IS NOT NULL) AS submitted_count
     ${CAMPAIGN_FROM} WHERE c.owner_id = ? ORDER BY c.created_at DESC`,
  )
    .bind(u.id)
    .all<CampaignRow & { submitted_count: number }>()
  return c.json({
    campaigns: results.map((r) => ({ ...mapCampaignCard(r), slotsPaid: r.slots_paid, escrow: r.escrow, submitted: r.submitted_count })),
  })
})

campaignRoutes.get('/:id', async (c) => {
  const u = requireUser(c)
  const r = await loadCampaign(c.env, c.req.param('id')!)
  if (!r || (r.hidden_at && r.owner_id !== u.id && u.role !== 'admin')) fail(404, 'not_found')
  const mine = await c.env.DB.prepare('SELECT id, status, credits_awarded FROM playtests WHERE campaign_id = ? AND tester_id = ?')
    .bind(r.id, u.id)
    .first<{ id: string; status: PlaytestStatus; credits_awarded: number | null }>()
  return c.json({ campaign: mapCampaignDetail(r, mine) })
})

/** Publish: freezes the questionnaire and moves slots × price into escrow in one transaction. */
campaignRoutes.post('/', async (c) => {
  const u = requireUser(c)
  const b = (await c.req.json()) as Partial<CampaignInput>
  const game = await c.env.DB.prepare('SELECT id FROM games WHERE id = ? AND owner_id = ? AND archived_at IS NULL')
    .bind(b.gameId ?? '', u.id)
    .first()
  if (!game) fail(422, 'unknown_game')
  const preset = playtimePreset(b.playtimePreset ?? '')
  if (!preset) fail(422, 'invalid_playtime')
  const slots = Number(b.slots)
  const price = Number(b.price)
  if (!validateSlots(slots)) fail(422, 'invalid_slots')
  if (!validatePrice(price)) fail(422, 'invalid_price')
  const minReputation = Math.max(0, Math.min(90, Math.floor(Number(b.minReputation ?? 0))))
  let questions: CampaignQuestion[]
  try {
    questions = buildSnapshot(b.catalogIds ?? [], b.custom ?? [])
  } catch (e) {
    fail(422, (e as Error).message)
  }
  if ((await ownerRecordingBytes(c.env.DB, u.id)) > RECORDING_QUOTA_BYTES) fail(409, 'recording_quota_exceeded')
  const cost = escrowFor(slots, price)
  if (u.credits < cost) fail(409, 'insufficient_credits')

  const id = newId()
  const t = now()
  try {
    await c.env.DB.batch([
      c.env.DB.prepare(
        `INSERT INTO campaigns (id, game_id, owner_id, build_label, build_url, instructions, playtime_preset, devices, min_minutes,
          slots_total, price, escrow, min_reputation, questions, status, published_at, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,'live',?,?,?)`,
      ).bind(
        id,
        b.gameId,
        u.id,
        str(b.buildLabel ?? '', 60, 1),
        b.buildUrl ? httpUrl(b.buildUrl) : null,
        str(b.instructions ?? '', 2000),
        preset.id,
        b.devices === 'desktop_mobile' ? 'desktop_mobile' : 'desktop',
        preset.minMinutes,
        slots,
        price,
        cost,
        minReputation,
        JSON.stringify(questions),
        t,
        t,
        t,
      ),
      ...creditStmt(c.env, u.id, -cost, 'campaign_escrow', 'campaign', id),
    ])
  } catch (e) {
    if (String(e).includes('CHECK')) fail(409, 'insufficient_credits')
    throw e
  }
  return c.json({ id })
})

async function ownCampaign(c: Context<AppEnv>) {
  const u = requireUser(c)
  const r = await loadCampaign(c.env, c.req.param('id')!)
  if (!r || r.owner_id !== u.id) fail(404, 'not_found')
  return { u, r }
}

campaignRoutes.post('/:id/pause', async (c) => {
  const { r } = await ownCampaign(c)
  if (r.status !== 'live') fail(409, 'not_live')
  await c.env.DB.prepare("UPDATE campaigns SET status = 'paused', updated_at = ? WHERE id = ?").bind(now(), r.id).run()
  return c.json({ ok: true })
})

campaignRoutes.post('/:id/resume', async (c) => {
  const { r } = await ownCampaign(c)
  if (r.status !== 'paused') fail(409, 'not_paused')
  await c.env.DB.prepare("UPDATE campaigns SET status = 'live', updated_at = ? WHERE id = ?").bind(now(), r.id).run()
  return c.json({ ok: true })
})

/** Cancel: refunds escrow except what testers who are already playing may still earn. */
campaignRoutes.post('/:id/cancel', async (c) => {
  const { u, r } = await ownCampaign(c)
  if (r.status !== 'live' && r.status !== 'paused') fail(409, 'not_active')
  const refund = Math.max(0, r.escrow - r.pending * r.price)
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE campaigns SET status = 'cancelled', escrow = escrow - ?, updated_at = ? WHERE id = ?").bind(refund, now(), r.id),
    ...(refund > 0 ? creditStmt(c.env, u.id, refund, 'escrow_refund', 'campaign', r.id) : []),
  ])
  return c.json({ ok: true, refund })
})

campaignRoutes.post('/:id/slots', async (c) => {
  const { u, r } = await ownCampaign(c)
  const add = Number(((await c.req.json()) as { add: number }).add)
  if (r.status !== 'live' && r.status !== 'paused' && r.status !== 'completed') fail(409, 'not_active')
  if (!Number.isInteger(add) || add < 1 || !validateSlots(r.slots_total + add)) fail(422, 'invalid_slots')
  if ((await ownerRecordingBytes(c.env.DB, u.id)) > RECORDING_QUOTA_BYTES) fail(409, 'recording_quota_exceeded')
  const cost = add * r.price
  try {
    await c.env.DB.batch([
      c.env.DB.prepare(
        "UPDATE campaigns SET slots_total = slots_total + ?, escrow = escrow + ?, status = CASE WHEN status = 'completed' THEN 'live' ELSE status END, updated_at = ? WHERE id = ?",
      ).bind(add, cost, now(), r.id),
      ...creditStmt(c.env, u.id, -cost, 'campaign_escrow', 'campaign', r.id),
    ])
  } catch (e) {
    if (String(e).includes('CHECK')) fail(409, 'insufficient_credits')
    throw e
  }
  return c.json({ ok: true })
})

/** All playtests of a campaign plus per-question aggregates, for the owner. */
campaignRoutes.get('/:id/results', async (c) => {
  const { r } = await ownCampaign(c)
  const questions = parseJson<CampaignQuestion[]>(r.questions, [])
  const { results } = await c.env.DB.prepare(
    `SELECT p.*, u.name AS t_name, u.avatar_url AS t_avatar, u.rep_up AS t_up, u.rep_down AS t_down
     FROM playtests p JOIN users u ON u.id = p.tester_id WHERE p.campaign_id = ? ORDER BY p.created_at DESC`,
  )
    .bind(r.id)
    .all<PlaytestDbRow & { t_name: string; t_avatar: string | null; t_up: number; t_down: number }>()
  const rows = results.map((p) =>
    mapPlaytestRow(p, { id: p.tester_id, name: p.t_name, avatarUrl: p.t_avatar, repUp: p.t_up, repDown: p.t_down }, questions.length),
  )
  const { results: answers } = await c.env.DB.prepare(
    `SELECT a.question_id, a.value, a.na, a.text, a.playtest_id, u.name AS tester
     FROM answers a JOIN playtests p ON p.id = a.playtest_id JOIN users u ON u.id = p.tester_id
     WHERE p.campaign_id = ? AND p.submitted_at IS NOT NULL`,
  )
    .bind(r.id)
    .all<{ question_id: string; value: number | null; na: number; text: string; playtest_id: string; tester: string }>()
  const aggregates = questions.map((q) => {
    const list = answers.filter((a) => a.question_id === q.id)
    const values = list.filter((a) => !a.na && a.value !== null).map((a) => a.value!)
    const dist = [0, 0, 0, 0, 0, 0]
    for (const v of values) dist[v] = (dist[v] ?? 0) + 1
    return {
      questionId: q.id,
      count: values.length,
      na: list.filter((a) => a.na).length,
      average: values.length ? values.reduce((s, v) => s + v, 0) / values.length : null,
      distribution: dist,
      texts: list.filter((a) => a.text.trim()).map((a) => ({ playtestId: a.playtest_id, tester: a.tester, text: a.text })),
    }
  })
  return c.json({ campaign: mapCampaignDetail(r, null), playtests: rows, aggregates, slotsPaid: r.slots_paid })
})

/** Reserve a slot. One atomic INSERT…SELECT, so two testers can never take the last slot together. */
campaignRoutes.post('/:id/start', async (c) => {
  const u = requireUser(c)
  const r = await loadCampaign(c.env, c.req.param('id')!)
  if (!r || r.status !== 'live' || r.hidden_at) fail(404, 'not_available')
  if (r.owner_id === u.id) fail(409, 'own_campaign')
  const me = await c.env.DB.prepare('SELECT rep_up, rep_down FROM users WHERE id = ?').bind(u.id).first<{ rep_up: number; rep_down: number }>()
  if (r.min_reputation > 0 && reputationScore(me!.rep_up, me!.rep_down) < r.min_reputation) fail(403, 'reputation_too_low')
  const existing = await c.env.DB.prepare('SELECT id FROM playtests WHERE campaign_id = ? AND tester_id = ?').bind(r.id, u.id).first<{ id: string }>()
  if (existing) return c.json({ id: existing.id })

  const id = newId()
  const t = now()
  const res = await c.env.DB.prepare(
    `INSERT INTO playtests (id, campaign_id, tester_id, status, reserved_until, created_at)
     SELECT ?1, ?2, ?3, 'reserved', ?4, ?5 FROM campaigns c
     WHERE c.id = ?2 AND c.status = 'live'
       AND c.slots_total - c.slots_paid - (SELECT COUNT(*) FROM playtests p WHERE p.campaign_id = c.id AND p.status IN ${PENDING_STATUSES}) > 0`,
  )
    .bind(id, r.id, u.id, t + reservationMs(r.min_minutes), t)
    .run()
  if (!res.meta.changes) fail(409, 'no_slots_left')
  return c.json({ id })
})
