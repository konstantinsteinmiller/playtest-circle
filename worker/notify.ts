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
