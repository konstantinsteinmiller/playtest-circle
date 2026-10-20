import { CAMPAIGN_ALERT_MIN_GAP_MS, COMMENT_MAIL_GAP_MS } from '../shared/rules'
import type { Env } from './env'
import { tr } from './i18n'
import { newId, now } from './lib'
import { sendMail } from './mail'

export type NotificationType =
  | 'playtest_received'
  | 'recording_expiring'
  | 'recording_evicted'
  | 'campaign_completed'
  | 'escrow_refunded'
  | 'credits_earned'
  | 'credits_granted'
  | 'game_comment'
  | 'replay_requested'
  | 'replay_declined'
  | 'replay_expired'

/** Types that also go out by email when the user keeps email notifications on. */
const EMAIL_TYPES: NotificationType[] = ['playtest_received', 'recording_expiring', 'campaign_completed', 'replay_requested']

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)

/**
 * Records an in-app notification and fans out to Discord / email per the user's settings.
 * Never throws: a failing webhook or mail server must not break the request that caused it.
 */
export async function notify(
  env: Env,
  userId: string,
  type: NotificationType,
  payload: Record<string, string | number>,
  link: string,
): Promise<void> {
  const full = { ...payload, link }
  await env.DB.prepare('INSERT INTO notifications (id, user_id, type, payload, created_at) VALUES (?, ?, ?, ?, ?)')
    .bind(newId(), userId, type, JSON.stringify(full), now())
    .run()

  const user = await env.DB.prepare('SELECT email, discord_webhook, email_opt_in, deleted_at FROM users WHERE id = ?')
    .bind(userId)
    .first<{ email: string; discord_webhook: string | null; email_opt_in: number; deleted_at: number | null }>()
  if (!user || user.deleted_at) return

  const title = tr(`notifications.${type}.title`, payload)
  const body = tr(`notifications.${type}.body`, payload)
  const url = new URL(link, env.APP_URL).toString()

  const jobs: Promise<unknown>[] = []
  if (user.discord_webhook?.startsWith('https://discord.com/api/webhooks/')) {
    jobs.push(
      fetch(user.discord_webhook, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          username: 'Playtest Circle',
          embeds: [{ title, description: body, url, color: 0xc6ff3d }],
        }),
      }),
    )
  }
  if (user.email_opt_in && EMAIL_TYPES.includes(type)) {
    const footer = tr('mail.footer')
    jobs.push(
      sendMail(env, {
        to: user.email,
        subject: title,
        text: `${body}\n\n${url}\n\n${footer}`,
        html: `<div style="font-family:system-ui,sans-serif;max-width:560px">
<h2 style="margin:0 0 12px">${esc(title)}</h2><p>${esc(body)}</p>
<p><a href="${esc(url)}" style="display:inline-block;background:#C6FF3D;color:#0B0B10;padding:10px 18px;border-radius:10px;font-weight:700;text-decoration:none">${esc(tr('mail.open'))}</a></p>
<p style="color:#555;font-size:12px">${esc(footer)}</p></div>`,
      }),
    )
  }
  const results = await Promise.allSettled(jobs)
  for (const r of results) if (r.status === 'rejected') console.error('[notify]', type, r.reason)
}

/**
 * A new public campaign: email everyone who opted into campaign alerts. Each user gets at most one a day,
 * and none again until they have been back in the app since the last one (last_seen_at is set by GET /me).
 */
export async function alertNewCampaign(env: Env, campaignId: string): Promise<void> {
  const c = await env.DB.prepare(
    `SELECT c.owner_id, c.price, c.invited_tester_id, g.title FROM campaigns c JOIN games g ON g.id = c.game_id WHERE c.id = ?`,
  )
    .bind(campaignId)
    .first<{ owner_id: string; price: number; invited_tester_id: string | null; title: string }>()
  if (!c || c.invited_tester_id) return
  const t = now()
  // Claim the recipients first, so two campaigns published at once can't both mail the same person.
  const { results } = await env.DB.prepare(
    `UPDATE users SET campaign_alert_at = ?1
     WHERE campaign_alerts = 1 AND email != '' AND guest = 0 AND deleted_at IS NULL AND banned_at IS NULL AND id != ?2
       AND (campaign_alert_at IS NULL OR (campaign_alert_at < ?3 AND last_seen_at > campaign_alert_at))
     RETURNING email`,
  )
    .bind(t, c.owner_id, t - CAMPAIGN_ALERT_MIN_GAP_MS)
    .all<{ email: string }>()
  const params = { game: c.title, credits: c.price }
  const title = tr('campaignAlert.title', params)
  const body = tr('campaignAlert.body', params)
  const url = new URL(`/c/${campaignId}`, env.APP_URL).toString()
  const footer = tr('campaignAlert.footer')
  const jobs = results.map((r) =>
    sendMail(env, {
      to: r.email,
      subject: title,
      text: `${body}\n\n${url}\n\n${footer}`,
      html: `<div style="font-family:system-ui,sans-serif;max-width:560px">
<h2 style="margin:0 0 12px">${esc(title)}</h2><p>${esc(body)}</p>
<p><a href="${esc(url)}" style="display:inline-block;background:#C6FF3D;color:#0B0B10;padding:10px 18px;border-radius:10px;font-weight:700;text-decoration:none">${esc(tr('campaignAlert.open'))}</a></p>
<p style="color:#555;font-size:12px">${esc(footer)}</p></div>`,
    }),
  )
  for (const r of await Promise.allSettled(jobs)) if (r.status === 'rejected') console.error('[campaign-alert]', r.reason)
}

/**
 * The first new comment on any of a dev's games in a day is emailed to them in full, with a link to it.
 * Later comments that day only show up in the app. Follows the owner's email setting; guests have no email.
 */
export async function mailComment(
  env: Env,
  ownerId: string,
  c: { id: string; gameId: string; game: string; author: string; text: string },
): Promise<boolean> {
  const t = now()
  // Claim today's email atomically, so two comments at once can't both send one.
  const owner = await env.DB.prepare(
    `UPDATE users SET comment_mail_at = ?1
     WHERE id = ?2 AND email_opt_in = 1 AND email != '' AND guest = 0 AND deleted_at IS NULL
       AND (comment_mail_at IS NULL OR comment_mail_at < ?3)
     RETURNING email`,
  )
    .bind(t, ownerId, t - COMMENT_MAIL_GAP_MS)
    .first<{ email: string }>()
  if (!owner) return false
  const params = { game: c.game, author: c.author }
  const title = tr('commentMail.title', params)
  const intro = tr('commentMail.intro', params)
  const footer = tr('commentMail.footer')
  const url = new URL(`/g/${c.gameId}#comment-${c.id}`, env.APP_URL).toString()
  const quote = esc(c.text).replace(/\n/g, '<br>')
  await sendMail(env, {
    to: owner.email,
    subject: title,
    text: `${intro}\n\n"${c.text}"\n\n— ${c.author}\n\n${tr('commentMail.open')}: ${url}\n\n${footer}`,
    html: `<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;max-width:560px;color:#0B0B10">
<h2 style="margin:0 0 12px;font-size:20px">${esc(title)}</h2>
<p style="margin:0 0 16px">${esc(intro)}</p>
<blockquote style="margin:0 0 8px;padding:12px 16px;border-left:4px solid #C6FF3D;background:#F4F4F6;border-radius:8px;font-size:15px;line-height:1.5">${quote}</blockquote>
<p style="margin:0 0 20px;color:#555;font-size:14px">— ${esc(c.author)}</p>
<p><a href="${esc(url)}" style="display:inline-block;background:#C6FF3D;color:#0B0B10;padding:10px 18px;border-radius:10px;font-weight:700;text-decoration:none">${esc(tr('commentMail.open'))}</a></p>
<p style="color:#555;font-size:12px">${esc(footer)}</p></div>`,
  })
  return true
}
