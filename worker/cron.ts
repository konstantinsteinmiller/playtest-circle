import { EXPIRY_WARNING_MS, REPLAY_TTL_MS } from '../shared/rules'
import { creditStmt, deleteRecording, enforceStorageBudget, recordingExpiry, releaseSlot, salvageUpload, type PlaytestDbRow } from './domain'
import type { Env } from './env'
import { now } from './lib'
import { notify } from './notify'
import { storage } from './storage'

/** Hourly housekeeping. Each step is idempotent, so a missed or doubled run is harmless. */
export async function runCron(env: Env) {
  const st = storage(env, env.APP_URL)
  const t = now()

  // 1. Reservations whose time ran out free their slot again.
  const { results: stale } = await env.DB.prepare(
    "SELECT * FROM playtests WHERE status IN ('reserved','recording') AND reserved_until < ?",
  )
    .bind(t)
    .all<PlaytestDbRow>()
  for (const p of stale) {
    // An interrupted recording (lost connection, crash, PC restart) keeps what reached storage.
    // The dev can watch it; no Credits move, so it costs them nothing.
    if (p.status === 'recording' && p.recording_key && p.upload_id) {
      const bytes = await salvageUpload(st, p.recording_key, p.upload_id)
      if (bytes > 0) {
        await env.DB.prepare(
          `UPDATE playtests SET status = 'no_payout', payout_reason = 'interrupted', upload_id = NULL, recording_bytes = ?,
             recording_expires_at = ?, stopped_at = COALESCE(stopped_at, ?), submitted_at = ? WHERE id = ?`,
        )
          .bind(bytes, recordingExpiry(t), t, t, p.id)
          .run()
        await releaseSlot(env, p.campaign_id)
        const info = await env.DB.prepare(
          'SELECT c.owner_id, g.title, u.name FROM campaigns c JOIN games g ON g.id = c.game_id JOIN users u ON u.id = ? WHERE c.id = ?',
        )
          .bind(p.tester_id, p.campaign_id)
          .first<{ owner_id: string; title: string; name: string }>()
        if (info) await notify(env, info.owner_id, 'playtest_received', { game: info.title, tester: info.name }, `/studio/playtests/${p.id}`)
        continue
      }
    }
    await deleteRecording(env, st, p, 'abandoned')
    await env.DB.prepare("UPDATE playtests SET status = 'expired', upload_id = NULL WHERE id = ?").bind(p.id).run()
    await releaseSlot(env, p.campaign_id)
  }

  // 2. Recordings past their 3 days are deleted.
  const { results: expired } = await env.DB.prepare(
    'SELECT * FROM playtests WHERE recording_deleted_at IS NULL AND recording_key IS NOT NULL AND recording_expires_at < ?',
  )
    .bind(t)
    .all<PlaytestDbRow>()
  for (const p of expired) await deleteRecording(env, st, p, 'expired')

  // 3. A day before deletion the dev gets one reminder.
  const { results: soon } = await env.DB.prepare(
    `SELECT p.id, c.owner_id, g.title FROM playtests p JOIN campaigns c ON c.id = p.campaign_id JOIN games g ON g.id = c.game_id
     WHERE p.recording_deleted_at IS NULL AND p.recording_key IS NOT NULL AND p.expiry_warned_at IS NULL
       AND p.recording_expires_at < ?`,
  )
    .bind(t + EXPIRY_WARNING_MS)
    .all<{ id: string; owner_id: string; title: string }>()
  for (const p of soon) {
    await env.DB.prepare('UPDATE playtests SET expiry_warned_at = ? WHERE id = ?').bind(t, p.id).run()
    await notify(env, p.owner_id, 'recording_expiring', { game: p.title }, `/studio/playtests/${p.id}`)
  }

  // 4. Replays nobody started within 14 days end, and the studio gets its escrow back.
  const { results: idle } = await env.DB.prepare(
    `SELECT c.id, c.owner_id, c.escrow, g.title, u.name FROM campaigns c JOIN games g ON g.id = c.game_id JOIN users u ON u.id = c.invited_tester_id
     WHERE c.invited_tester_id IS NOT NULL AND c.status IN ('live','paused') AND c.published_at < ?
       AND NOT EXISTS (SELECT 1 FROM playtests p WHERE p.campaign_id = c.id)`,
  )
    .bind(t - REPLAY_TTL_MS)
    .all<{ id: string; owner_id: string; escrow: number; title: string; name: string }>()
  for (const r of idle) {
    await env.DB.batch([
      env.DB.prepare("UPDATE campaigns SET status = 'cancelled', escrow = 0, updated_at = ? WHERE id = ?").bind(t, r.id),
      ...(r.escrow > 0 ? creditStmt(env, r.owner_id, r.escrow, 'escrow_refund', 'campaign', r.id) : []),
    ])
    await notify(env, r.owner_id, 'replay_expired', { game: r.title, tester: r.name, credits: r.escrow }, `/studio/campaigns/${r.id}`)
  }

  // 5. Stay under the global storage budget even without new uploads.
  await enforceStorageBudget(env, st, 0)

  // 6. Housekeeping of auth tables.
  await env.DB.batch([
    env.DB.prepare('DELETE FROM sessions WHERE expires_at < ?').bind(t),
    env.DB.prepare('DELETE FROM oauth_states WHERE expires_at < ?').bind(t),
  ])
}
