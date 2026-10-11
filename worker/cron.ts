import { EXPIRY_WARNING_MS } from '../shared/rules'
import { deleteRecording, enforceStorageBudget, releaseSlot, type PlaytestDbRow } from './domain'
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

  // 4. Stay under the global storage budget even without new uploads.
  await enforceStorageBudget(env, st, 0)

  // 5. Housekeeping of auth tables.
  await env.DB.batch([
    env.DB.prepare('DELETE FROM sessions WHERE expires_at < ?').bind(t),
    env.DB.prepare('DELETE FROM oauth_states WHERE expires_at < ?').bind(t),
  ])
}
