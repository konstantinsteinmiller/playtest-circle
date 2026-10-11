import type { CampaignQuestion } from '../shared/questions'
import { RECORDING_TTL_MS, STORAGE_BUDGET_BYTES, pickEvictions, playtimePreset, type PayoutReason, type PlaytimePresetId, type DeviceTarget } from '../shared/rules'
import type {
  CampaignCard,
  CampaignDetail,
  CampaignStatus,
  Game,
  GameHost,
  PlaytestRow,
  PlaytestStatus,
  PublicUser,
} from '../shared/types'
import type { Env } from './env'
import { newId, now, parseJson } from './lib'
import { notify } from './notify'
import type { StorageDriver } from './storage'

export const mediaUrl = (key: string | null) => (key ? `/api/media/${key}` : null)

/** Statuses that hold a slot while the tester is still playing or uploading. */
export const PENDING_STATUSES = `('reserved','recording','submitted')`

// ---------------------------------------------------------------- games

export interface GameRow {
  id: string
  owner_id: string
  title: string
  pitch: string
  description: string
  tags: string
  play_url: string
  host: GameHost
  access_notes: string
  trailer_url: string | null
  cover_key: string | null
  hover_clip_key: string | null
  screenshots: string
  created_at: number
}

export function mapGame(r: GameRow): Game {
  return {
    id: r.id,
    ownerId: r.owner_id,
    title: r.title,
    pitch: r.pitch,
    description: r.description,
    tags: parseJson<string[]>(r.tags, []),
    playUrl: r.play_url,
    host: r.host,
    accessNotes: r.access_notes,
    trailerUrl: r.trailer_url,
    coverUrl: mediaUrl(r.cover_key),
    hoverClipUrl: mediaUrl(r.hover_clip_key),
    screenshots: parseJson<string[]>(r.screenshots, []).map((k) => mediaUrl(k)!),
    createdAt: r.created_at,
  }
}

// ---------------------------------------------------------------- campaigns

/** Columns for a campaign joined with its game and owner. Use with CAMPAIGN_FROM. */
export const CAMPAIGN_SELECT = `
  c.id, c.status, c.build_label, c.build_url, c.instructions, c.price, c.playtime_preset, c.devices, c.min_minutes,
  c.slots_total, c.slots_paid, c.escrow, c.min_reputation, c.questions, c.published_at, c.owner_id, c.hidden_at,
  (SELECT COUNT(*) FROM playtests p WHERE p.campaign_id = c.id AND p.status IN ${PENDING_STATUSES}) AS pending,
  g.id AS g_id, g.owner_id AS g_owner_id, g.title AS g_title, g.pitch AS g_pitch, g.description AS g_description,
  g.tags AS g_tags, g.play_url AS g_play_url, g.host AS g_host, g.access_notes AS g_access_notes,
  g.trailer_url AS g_trailer_url, g.cover_key AS g_cover_key, g.hover_clip_key AS g_hover_clip_key,
  g.screenshots AS g_screenshots, g.created_at AS g_created_at,
  u.name AS u_name, u.avatar_url AS u_avatar_url, u.rep_up AS u_rep_up, u.rep_down AS u_rep_down`

export const CAMPAIGN_FROM = `FROM campaigns c JOIN games g ON g.id = c.game_id JOIN users u ON u.id = c.owner_id`

export interface CampaignRow {
  id: string
  status: CampaignStatus
  build_label: string
  build_url: string | null
  instructions: string
  price: number
  playtime_preset: PlaytimePresetId
  devices: DeviceTarget
  min_minutes: number
  slots_total: number
  slots_paid: number
  escrow: number
  min_reputation: number
  questions: string
  published_at: number | null
  owner_id: string
  hidden_at: number | null
  pending: number
  g_id: string
  g_owner_id: string
  g_title: string
  g_pitch: string
  g_description: string
  g_tags: string
  g_play_url: string
  g_host: GameHost
  g_access_notes: string
  g_trailer_url: string | null
  g_cover_key: string | null
  g_hover_clip_key: string | null
  g_screenshots: string
  g_created_at: number
  u_name: string
  u_avatar_url: string | null
  u_rep_up: number
  u_rep_down: number
}

const gameOf = (r: CampaignRow): Game =>
  mapGame({
    id: r.g_id,
    owner_id: r.g_owner_id,
    title: r.g_title,
    pitch: r.g_pitch,
    description: r.g_description,
    tags: r.g_tags,
    play_url: r.g_play_url,
    host: r.g_host,
    access_notes: r.g_access_notes,
    trailer_url: r.g_trailer_url,
    cover_key: r.g_cover_key,
    hover_clip_key: r.g_hover_clip_key,
    screenshots: r.g_screenshots,
    created_at: r.g_created_at,
  })

export const slotsLeft = (r: Pick<CampaignRow, 'slots_total' | 'slots_paid' | 'pending'>) =>
  Math.max(0, r.slots_total - r.slots_paid - r.pending)

export function mapCampaignCard(r: CampaignRow): CampaignCard {
  const g = gameOf(r)
  return {
    id: r.id,
    status: r.status,
    buildLabel: r.build_label,
    price: r.price,
    playtimePreset: r.playtime_preset,
    devices: r.devices === 'desktop_mobile' ? 'desktop_mobile' : 'desktop',
    minMinutes: r.min_minutes,
    slotsTotal: r.slots_total,
    slotsLeft: slotsLeft(r),
    publishedAt: r.published_at,
    game: { id: g.id, title: g.title, pitch: g.pitch, tags: g.tags, host: g.host, coverUrl: g.coverUrl, hoverClipUrl: g.hoverClipUrl },
    owner: { id: r.owner_id, name: r.u_name, avatarUrl: r.u_avatar_url, repUp: r.u_rep_up, repDown: r.u_rep_down },
  }
}

export function mapCampaignDetail(
  r: CampaignRow,
  mine: { id: string; status: PlaytestStatus } | null,
): CampaignDetail {
  const game = gameOf(r)
  return {
    ...mapCampaignCard(r),
    instructions: r.instructions,
    buildUrl: r.build_url || game.playUrl,
    minReputation: r.min_reputation,
    questions: parseJson<CampaignQuestion[]>(r.questions, []),
    game,
    escrow: r.escrow,
    myPlaytestId: mine?.id ?? null,
    myPlaytestStatus: mine?.status ?? null,
  }
}

export async function loadCampaign(env: Env, id: string): Promise<CampaignRow | null> {
  return env.DB.prepare(`SELECT ${CAMPAIGN_SELECT} ${CAMPAIGN_FROM} WHERE c.id = ?`).bind(id).first<CampaignRow>()
}

export function targetMinutes(r: Pick<CampaignRow, 'playtime_preset' | 'min_minutes'>): number {
  return playtimePreset(r.playtime_preset)?.targetMinutes ?? r.min_minutes * 2
}

// ---------------------------------------------------------------- playtests

export interface PlaytestDbRow {
  id: string
  campaign_id: string
  tester_id: string
  status: PlaytestStatus
  reserved_until: number
  started_at: number | null
  stopped_at: number | null
  active_ms: number | null
  recorder_ms: number | null
  used_mic: number
  upload_id: string | null
  recording_key: string | null
  recording_bytes: number
  recording_mime: string | null
  recording_expires_at: number | null
  recording_deleted_at: number | null
  recording_viewed_at: number | null
  quit_early: number
  answered: number
  required: number
  credits_awarded: number
  payout_reason: PayoutReason | null
  dev_rating: number | null
  dev_rating_note: string
  tidy_bonus_at: number | null
  submitted_at: number | null
  created_at: number
}

export function mapPlaytestRow(p: PlaytestDbRow, tester: PublicUser, totalQuestions: number): PlaytestRow {
  return {
    id: p.id,
    campaignId: p.campaign_id,
    status: p.status,
    tester,
    activeMs: p.active_ms,
    answered: p.answered,
    required: p.required,
    totalQuestions,
    creditsAwarded: p.credits_awarded,
    payoutReason: p.payout_reason,
    submittedAt: p.submitted_at,
    recordingExpiresAt: p.recording_deleted_at ? null : p.recording_expires_at,
    recordingDeleted: !!p.recording_deleted_at || !p.recording_key,
    recordingBytes: p.recording_bytes,
    devRating: p.dev_rating === 1 ? 1 : p.dev_rating === -1 ? -1 : null,
    usedMic: !!p.used_mic,
  }
}

export const recordingExpiry = (submittedAt: number) => submittedAt + RECORDING_TTL_MS

export type DeleteReason = 'owner' | 'expired' | 'evicted' | 'account_deleted' | 'abandoned'

/** Removes a recording object and marks the row. Safe to call twice. */
export async function deleteRecording(env: Env, st: StorageDriver, p: Pick<PlaytestDbRow, 'id' | 'recording_key' | 'upload_id' | 'status'>, reason: DeleteReason) {
  if (p.recording_key) {
    if (p.upload_id && (p.status === 'recording' || p.status === 'reserved')) await st.abortMultipart(p.recording_key, p.upload_id).catch(() => {})
    await st.delete(p.recording_key).catch((e) => console.error('[delete]', p.recording_key, e))
  }
  await env.DB.prepare(
    'UPDATE playtests SET recording_deleted_at = ?, recording_delete_reason = ? WHERE id = ? AND recording_deleted_at IS NULL',
  )
    .bind(now(), reason, p.id)
    .run()
}

/**
 * Keeps all recordings together under the global storage budget.
 * Order: recordings the dev already watched (oldest first), then the oldest unwatched ones.
 */
export async function enforceStorageBudget(env: Env, st: StorageDriver, incomingBytes: number, budget = STORAGE_BUDGET_BYTES) {
  const { results } = await env.DB.prepare(
    `SELECT p.id, p.recording_key, p.upload_id, p.status, p.recording_bytes, p.submitted_at, p.recording_viewed_at,
            p.campaign_id, c.owner_id, g.title
     FROM playtests p JOIN campaigns c ON c.id = p.campaign_id JOIN games g ON g.id = c.game_id
     WHERE p.recording_key IS NOT NULL AND p.recording_deleted_at IS NULL AND p.submitted_at IS NOT NULL`,
  ).all<PlaytestDbRow & { owner_id: string; title: string }>()
  const inFlight = await env.DB.prepare(
    `SELECT COALESCE(SUM(recording_bytes), 0) AS b FROM playtests
     WHERE recording_key IS NOT NULL AND recording_deleted_at IS NULL AND submitted_at IS NULL`,
  ).first<{ b: number }>()
  const total = results.reduce((s, r) => s + r.recording_bytes, 0) + (inFlight?.b ?? 0)
  const ids = pickEvictions(
    results.map((r) => ({ id: r.id, bytes: r.recording_bytes, submittedAt: r.submitted_at!, viewedAt: r.recording_viewed_at })),
    total,
    incomingBytes,
    budget,
  )
  for (const id of ids) {
    const r = results.find((x) => x.id === id)!
    await deleteRecording(env, st, r, 'evicted')
    await notify(env, r.owner_id, 'recording_evicted', { game: r.title }, `/studio/playtests/${r.id}`)
  }
  return ids
}

/** Statements that move Credits. D1 batches run as one transaction, and CHECK (credits >= 0) aborts overdrafts. */
export function creditStmt(env: Env, userId: string, delta: number, reason: string, refType: string | null, refId: string | null) {
  return [
    env.DB.prepare('UPDATE users SET credits = credits + ? WHERE id = ?').bind(delta, userId),
    env.DB.prepare('INSERT INTO credit_ledger (id, user_id, delta, reason, ref_type, ref_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(
      newId(),
      userId,
      delta,
      reason,
      refType,
      refId,
      now(),
    ),
  ]
}

/**
 * A slot freed by a playtest that will never pay out. On a live campaign it simply goes back
 * to the pool; on a cancelled one its escrow returns to the owner.
 */
export async function releaseSlot(env: Env, campaignId: string) {
  const c = await env.DB.prepare('SELECT owner_id, status, price, escrow FROM campaigns WHERE id = ?')
    .bind(campaignId)
    .first<{ owner_id: string; status: CampaignStatus; price: number; escrow: number }>()
  if (!c || c.status !== 'cancelled' || c.escrow < c.price) return
  await env.DB.batch([
    env.DB.prepare('UPDATE campaigns SET escrow = escrow - ? WHERE id = ?').bind(c.price, campaignId),
    ...creditStmt(env, c.owner_id, c.price, 'escrow_refund', 'campaign', campaignId),
  ])
}
