import { Hono, type Context } from 'hono'
import { countAnswered, maxValue, type AnswerInput, type CampaignQuestion } from '../../shared/questions'
import {
  MAX_ANSWER_TEXT,
  MAX_NOTE_LENGTH,
  RECORDING,
  TIDY_BONUS,
  canClaimTidyBonus,
  evaluatePayout,
} from '../../shared/rules'
import type { AnswerRow, Note, PlaytestDetail } from '../../shared/types'
import { requireUser } from '../auth/session'
import {
  creditStmt,
  deleteRecording,
  enforceStorageBudget,
  loadCampaign,
  mapCampaignDetail,
  mapPlaytestRow,
  recordingExpiry,
  salvageUpload,
  releaseSlot,
  targetMinutes,
  type PlaytestDbRow,
} from '../domain'
import type { AppEnv } from '../env'
import { fail, newId, now, parseJson, str } from '../lib'
import { notify } from '../notify'
import { storage, type UploadedPart } from '../storage'

export const playtestRoutes = new Hono<AppEnv>()

const MIME_EXT: Record<string, string> = { 'video/mp4': 'mp4', 'video/webm': 'webm' }

async function load(c: Context<AppEnv>) {
  const u = requireUser(c)
  const p = await c.env.DB.prepare('SELECT * FROM playtests WHERE id = ?').bind(c.req.param('id')).first<PlaytestDbRow>()
  if (!p) fail(404, 'not_found')
  const campaign = await loadCampaign(c.env, p.campaign_id)
  if (!campaign) fail(404, 'not_found')
  const isTester = p.tester_id === u.id
  const isOwner = campaign.owner_id === u.id
  if (!isTester && !isOwner && u.role !== 'admin') fail(404, 'not_found')
  return { u, p, campaign, isTester, isOwner, st: storage(c.env, new URL(c.req.url).origin) }
}

function minuteMs(env: AppEnv['Bindings']) {
  const v = Number(env.TEST_MINUTE_MS)
  return v > 0 ? v : 60_000
}

playtestRoutes.get('/mine', async (c) => {
  const u = requireUser(c)
  const { results } = await c.env.DB.prepare(
    `SELECT p.id, p.status, p.credits_awarded, p.payout_reason, p.submitted_at, p.created_at, p.active_ms,
            g.title, c.id AS campaign_id, c.price, c.build_label, g.cover_key,
            (p.recording_key IS NOT NULL AND p.recording_deleted_at IS NULL AND p.submitted_at IS NOT NULL) AS has_recording
     FROM playtests p JOIN campaigns c ON c.id = p.campaign_id JOIN games g ON g.id = c.game_id
     WHERE p.tester_id = ? ORDER BY p.created_at DESC LIMIT 100`,
  )
    .bind(u.id)
    .all()
  return c.json({ playtests: results })
})

playtestRoutes.get('/:id', async (c) => {
  const { p, campaign, isOwner, isTester, st } = await load(c)
  const questions = parseJson<CampaignQuestion[]>(campaign.questions, [])
  const tester = await c.env.DB.prepare('SELECT id, name, avatar_url, rep_up, rep_down FROM users WHERE id = ?')
    .bind(p.tester_id)
    .first<{ id: string; name: string; avatar_url: string | null; rep_up: number; rep_down: number }>()
  const { results: answers } = await c.env.DB.prepare('SELECT question_id, value, na, text FROM answers WHERE playtest_id = ?')
    .bind(p.id)
    .all<{ question_id: string; value: number | null; na: number; text: string }>()
  const { results: notes } = await c.env.DB.prepare('SELECT id, offset_ms, text FROM notes WHERE playtest_id = ? ORDER BY offset_ms')
    .bind(p.id)
    .all<{ id: string; offset_ms: number; text: string }>()
  const playable = p.recording_key && !p.recording_deleted_at && p.submitted_at && (isOwner || isTester)
  const detail: PlaytestDetail = {
    ...mapPlaytestRow(
      p,
      { id: tester!.id, name: tester!.name, avatarUrl: tester!.avatar_url, repUp: tester!.rep_up, repDown: tester!.rep_down },
      questions.length,
    ),
    campaign: mapCampaignDetail(campaign, { id: p.id, status: p.status }),
    answers: answers.map<AnswerRow>((a) => ({ questionId: a.question_id, value: a.value, na: !!a.na, text: a.text })),
    notes: notes.map<Note>((n) => ({ id: n.id, offsetMs: n.offset_ms, text: n.text })),
    recordingUrl: playable ? await st.getUrl(p.recording_key!, 6 * 3600) : null,
    recordingMime: p.recording_mime,
    devRatingNote: isOwner ? p.dev_rating_note : '',
    startedAt: p.started_at,
    reservedUntil: p.reserved_until,
  }
  return c.json({ playtest: detail, role: isOwner ? 'owner' : 'tester', minuteMs: minuteMs(c.env) })
})

/** Begins the recording: opens a multipart upload that the client streams parts into while playing. */
playtestRoutes.post('/:id/recording/start', async (c) => {
  const { p, campaign, isTester, st } = await load(c)
  if (!isTester) fail(403, 'not_tester')
  if (p.status !== 'reserved' && p.status !== 'recording') fail(409, 'not_startable')
  if (p.reserved_until < now()) fail(409, 'reservation_expired')
  if (campaign.status !== 'live' && campaign.status !== 'paused') fail(409, 'campaign_closed')
  const b = (await c.req.json()) as { mime: string; usedMic: boolean }
  const base = b.mime.split(';')[0]
  const ext = MIME_EXT[base]
  if (!ext) fail(422, 'unsupported_mime')

  // Restarting (e.g. the tester picked the wrong tab) throws the previous upload away.
  if (p.upload_id && p.recording_key) await st.abortMultipart(p.recording_key, p.upload_id).catch(() => {})

  const bytesPerMin = ((RECORDING.videoBitsPerSecond + RECORDING.audioBitsPerSecond) / 8) * 60
  await enforceStorageBudget(c.env, st, targetMinutes(campaign) * bytesPerMin)

  const key = `recordings/${campaign.id}/${p.id}.${ext}`
  const uploadId = await st.createMultipart(key, base)
  await c.env.DB.prepare(
    `UPDATE playtests SET status = 'recording', started_at = ?, stopped_at = NULL, upload_id = ?, recording_key = ?,
       recording_mime = ?, used_mic = ?, recording_bytes = 0 WHERE id = ?`,
  )
    .bind(now(), uploadId, key, base, b.usedMic ? 1 : 0, p.id)
    .run()
  return c.json({ ok: true })
})

/** What storage holds for the running recording, so the tester learns about a failed upload before the questionnaire. */
playtestRoutes.get('/:id/recording/status', async (c) => {
  const { p, isTester, st } = await load(c)
  if (!isTester || p.status !== 'recording' || !p.upload_id || !p.recording_key) fail(409, 'not_recording')
  const parts = await st.listParts(p.recording_key, p.upload_id).catch(() => null)
  if (!parts) return c.json({ known: false, parts: 0, bytes: 0 })
  return c.json({ known: true, parts: parts.length, bytes: parts.reduce((n, x) => n + (x.size ?? 0), 0) })
})

playtestRoutes.post('/:id/recording/part', async (c) => {
  const { p, isTester, st } = await load(c)
  if (!isTester || p.status !== 'recording' || !p.upload_id || !p.recording_key) fail(409, 'not_recording')
  const { partNumber } = (await c.req.json()) as { partNumber: number }
  if (!Number.isInteger(partNumber) || partNumber < 1 || partNumber > 10_000) fail(422, 'invalid_part')
  return c.json({ url: await st.partUrl(p.recording_key, p.upload_id, partNumber) })
})

playtestRoutes.post('/:id/recording/stop', async (c) => {
  const { p, isTester } = await load(c)
  if (!isTester || p.status !== 'recording') fail(409, 'not_recording')
  const { recorderMs } = (await c.req.json()) as { recorderMs: number }
  await c.env.DB.prepare('UPDATE playtests SET stopped_at = COALESCE(stopped_at, ?), recorder_ms = ? WHERE id = ?')
    .bind(now(), Math.max(0, Math.floor(recorderMs || 0)), p.id)
    .run()
  return c.json({ ok: true })
})

playtestRoutes.post('/:id/notes', async (c) => {
  const { p, isTester } = await load(c)
  if (!isTester || (p.status !== 'recording' && p.status !== 'reserved')) fail(409, 'not_recording')
  const b = (await c.req.json()) as { offsetMs: number; text: string }
  const id = newId()
  const offset = Math.max(0, Math.floor(Number(b.offsetMs) || 0))
  await c.env.DB.prepare('INSERT INTO notes (id, playtest_id, offset_ms, text, created_at) VALUES (?, ?, ?, ?, ?)')
    .bind(id, p.id, offset, str(b.text ?? '', MAX_NOTE_LENGTH), now())
    .run()
  return c.json({ id })
})

playtestRoutes.delete('/:id/notes/:noteId', async (c) => {
  const { p, isTester } = await load(c)
  if (!isTester || p.submitted_at) fail(409, 'locked')
  await c.env.DB.prepare('DELETE FROM notes WHERE id = ? AND playtest_id = ?').bind(c.req.param('noteId'), p.id).run()
  return c.json({ ok: true })
})

/** Finishes the upload, stores the questionnaire and pays the tester automatically if the rules are met. */
playtestRoutes.post('/:id/submit', async (c) => {
  const { u, p, campaign, isTester, st } = await load(c)
  if (!isTester) fail(403, 'not_tester')
  if (p.status !== 'recording') fail(409, 'not_recording')
  const b = (await c.req.json()) as { answers: AnswerInput[]; parts: UploadedPart[]; recorderMs: number; uploadError?: unknown }
  const questions = parseJson<CampaignQuestion[]>(campaign.questions, [])
  const qIds = new Set(questions.map((q) => q.id))

  const answers: AnswerInput[] = (b.answers ?? [])
    .filter((a) => qIds.has(a.questionId))
    .map((a) => {
      const q = questions.find((x) => x.id === a.questionId)!
      const max = maxValue(q.type)
      const value = a.value === null || a.value === undefined ? null : Math.floor(Number(a.value))
      return {
        questionId: a.questionId,
        value: value !== null && value >= 0 && value <= max ? value : null,
        na: !!a.na && q.allowNa,
        text: typeof a.text === 'string' ? a.text.slice(0, MAX_ANSWER_TEXT) : '',
      }
    })

  let uploadComplete = false
  let bytes = 0
  if (p.recording_key && p.upload_id) {
    bytes = await salvageUpload(st, p.recording_key, p.upload_id, Array.isArray(b.parts) ? b.parts : [])
    uploadComplete = bytes > 0
  }
  const uploadNote = typeof b.uploadError === 'string' && b.uploadError ? b.uploadError.slice(0, 300) : null
  if (!uploadComplete) console.error('[submit] no recording', p.id, uploadNote, Array.isArray(b.parts) ? b.parts.length : 'none')

  const t = now()
  const stoppedAt = p.stopped_at ?? t
  const activeMs = Math.max(0, stoppedAt - (p.started_at ?? stoppedAt))
  const recorderMs = Math.max(0, Math.floor(Number(b.recorderMs) || p.recorder_ms || 0))
  const mm = minuteMs(c.env)
  const quitEarly = Math.min(activeMs, recorderMs) < campaign.min_minutes * mm
  const counts = countAnswered(questions, answers, quitEarly)
  const reason = evaluatePayout({
    minMinutes: campaign.min_minutes,
    activeMs,
    recorderMs,
    recordingBytes: bytes,
    uploadComplete,
    requiredCount: counts.required,
    requiredAnswered: counts.requiredAnswered,
    quitReasonChars: answers.find((a) => a.questionId === 'sys_quit_reason')?.text.trim().length ?? 0,
    minuteMs: mm,
  })
  const paid = reason === 'paid'

  const stmts: D1PreparedStatement[] = [
    c.env.DB.prepare('DELETE FROM answers WHERE playtest_id = ?').bind(p.id),
    ...answers.map((a) =>
      c.env.DB.prepare('INSERT INTO answers (playtest_id, question_id, value, na, text) VALUES (?, ?, ?, ?, ?)').bind(
        p.id,
        a.questionId,
        a.value,
        a.na ? 1 : 0,
        a.text,
      ),
    ),
    c.env.DB.prepare(
      `UPDATE playtests SET status = ?, stopped_at = ?, active_ms = ?, recorder_ms = ?, recording_bytes = ?,
         recording_expires_at = ?, recording_key = ?, upload_id = NULL, quit_early = ?, answered = ?, required = ?,
         credits_awarded = ?, payout_reason = ?, submitted_at = ?, upload_note = ? WHERE id = ? AND status = 'recording'`,
    ).bind(
      paid ? 'paid' : 'no_payout',
      stoppedAt,
      activeMs,
      recorderMs,
      bytes,
      uploadComplete ? recordingExpiry(t) : null,
      uploadComplete ? p.recording_key : null,
      quitEarly ? 1 : 0,
      counts.answered,
      counts.required,
      paid ? campaign.price : 0,
      reason,
      t,
      uploadNote,
      p.id,
    ),
  ]
  if (paid) {
    stmts.push(
      c.env.DB.prepare(
        `UPDATE campaigns SET escrow = escrow - price, slots_paid = slots_paid + 1, updated_at = ?,
           status = CASE WHEN slots_paid + 1 >= slots_total AND status = 'live' THEN 'completed' ELSE status END
         WHERE id = ?`,
      ).bind(t, campaign.id),
      ...creditStmt(c.env, u.id, campaign.price, 'playtest_reward', 'playtest', p.id),
    )
  }
  await c.env.DB.batch(stmts)
  if (!paid) await releaseSlot(c.env, campaign.id)

  const game = campaign.g_title
  const work = (async () => {
    await notify(c.env, campaign.owner_id, 'playtest_received', { game, tester: u.name }, `/studio/playtests/${p.id}`)
    if (paid) await notify(c.env, u.id, 'credits_earned', { game, credits: campaign.price }, '/wallet')
    const after = await c.env.DB.prepare('SELECT status FROM campaigns WHERE id = ?').bind(campaign.id).first<{ status: string }>()
    if (paid && after?.status === 'completed' && campaign.status === 'live') {
      await notify(c.env, campaign.owner_id, 'campaign_completed', { game }, `/studio/campaigns/${campaign.id}`)
    }
  })()
  c.executionCtx.waitUntil(work.catch((e) => console.error('[notify]', e)))

  return c.json({ reason, credits: paid ? campaign.price : 0, ...counts, activeMs, quitEarly })
})

playtestRoutes.post('/:id/abandon', async (c) => {
  const { p, isTester, st } = await load(c)
  if (!isTester || (p.status !== 'reserved' && p.status !== 'recording')) fail(409, 'not_active')
  await deleteRecording(c.env, st, p, 'abandoned')
  await c.env.DB.prepare("UPDATE playtests SET status = 'expired', upload_id = NULL WHERE id = ?").bind(p.id).run()
  await releaseSlot(c.env, p.campaign_id)
  return c.json({ ok: true })
})

playtestRoutes.post('/:id/viewed', async (c) => {
  const { p, isOwner } = await load(c)
  if (isOwner) await c.env.DB.prepare('UPDATE playtests SET recording_viewed_at = COALESCE(recording_viewed_at, ?) WHERE id = ?').bind(now(), p.id).run()
  return c.json({ ok: true })
})

/** The dev's 👍/👎 feeds the tester's public reputation. It never changes the payout. */
playtestRoutes.post('/:id/rate', async (c) => {
  const { p, isOwner } = await load(c)
  if (!isOwner || !p.submitted_at) fail(409, 'not_rateable')
  const b = (await c.req.json()) as { rating: 1 | -1 | null; note?: string }
  const rating = b.rating === 1 || b.rating === -1 ? b.rating : null
  const prev = p.dev_rating
  const upDelta = (rating === 1 ? 1 : 0) - (prev === 1 ? 1 : 0)
  const downDelta = (rating === -1 ? 1 : 0) - (prev === -1 ? 1 : 0)
  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE playtests SET dev_rating = ?, dev_rating_note = ? WHERE id = ?').bind(rating, str(b.note ?? '', 500), p.id),
    c.env.DB.prepare('UPDATE users SET rep_up = rep_up + ?, rep_down = rep_down + ? WHERE id = ?').bind(upDelta, downDelta, p.tester_id),
  ])
  return c.json({ ok: true })
})

/** Owner deletes a reviewed recording. Within 24 h of submission it refunds the tidy bonus once. */
playtestRoutes.delete('/:id/recording', async (c) => {
  const { u, p, isOwner, st } = await load(c)
  if (!isOwner) fail(403, 'not_owner')
  if (!p.recording_key || p.recording_deleted_at) return c.json({ ok: true, bonus: 0 })
  await deleteRecording(c.env, st, p, 'owner')
  let bonus = 0
  if (p.submitted_at && !p.tidy_bonus_at && canClaimTidyBonus(p.submitted_at, now())) {
    const res = await c.env.DB.prepare('UPDATE playtests SET tidy_bonus_at = ? WHERE id = ? AND tidy_bonus_at IS NULL').bind(now(), p.id).run()
    if (res.meta.changes) {
      await c.env.DB.batch(creditStmt(c.env, u.id, TIDY_BONUS, 'tidy_bonus', 'playtest', p.id))
      bonus = TIDY_BONUS
    }
  }
  return c.json({ ok: true, bonus })
})
