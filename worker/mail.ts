import { connect } from 'cloudflare:sockets'
import type { Env } from './env'

export interface Mail {
  to: string
  subject: string
  text: string
  html: string
}

/**
 * Free transactional email without owning a domain: Gmail SMTP (implicit TLS, port 465)
 * authenticated with an app password of the operator's Google account. ~500 mails/day.
 * MAIL_DRIVER=resend switches to Resend once a verified domain exists.
 */
export async function sendMail(env: Env, mail: Mail): Promise<void> {
  const driver = env.MAIL_DRIVER ?? 'none'
  if (driver === 'gmail' && env.SMTP_USER && env.SMTP_PASS) return smtpSend(env, mail)
  if (driver === 'resend' && env.RESEND_API_KEY && env.MAIL_FROM) {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify({ from: env.MAIL_FROM, to: mail.to, subject: mail.subject, text: mail.text, html: mail.html }),
    })
    if (!res.ok) throw new Error(`resend_failed:${res.status}`)
    return
  }
  console.log('[mail:none]', mail.to, mail.subject)
}

const enc = new TextEncoder()
const b64 = (s: string) => {
  let bin = ''
  for (const b of enc.encode(s)) bin += String.fromCharCode(b)
  return btoa(bin)
}
const wrap76 = (s: string) => s.replace(/.{1,76}/g, '$&\r\n')

export function buildMime(from: string, fromName: string, mail: Mail): string {
  const boundary = `ptc-${crypto.randomUUID()}`
  return [
    `From: =?UTF-8?B?${b64(fromName)}?= <${from}>`,
    `To: <${mail.to}>`,
    `Subject: =?UTF-8?B?${b64(mail.subject)}?=`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${crypto.randomUUID()}@playtest-circle>`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    wrap76(b64(mail.text)),
    `--${boundary}`,
    'Content-Type: text/html; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    wrap76(b64(mail.html)),
    `--${boundary}--`,
    '',
  ].join('\r\n')
}

async function smtpSend(env: Env, mail: Mail) {
  const socket = connect({ hostname: 'smtp.gmail.com', port: 465 }, { secureTransport: 'on', allowHalfOpen: false })
  const writer = socket.writable.getWriter()
  const reader = socket.readable.getReader()
  const dec = new TextDecoder()
  let buf = ''

  async function reply(expect: number) {
    for (;;) {
      const lines = buf.split('\r\n')
      // A final reply line is "250 text"; continuation lines are "250-text".
      const done = lines.findIndex((l) => /^\d{3} /.test(l))
      if (done >= 0) {
        const line = lines[done]
        buf = lines.slice(done + 1).join('\r\n')
        if (Number(line.slice(0, 3)) !== expect) throw new Error(`smtp_${line}`)
        return
      }
      const { value, done: eof } = await reader.read()
      if (eof) throw new Error('smtp_closed')
      buf += dec.decode(value, { stream: true })
    }
  }
  const send = (s: string) => writer.write(enc.encode(s + '\r\n'))

  try {
    await reply(220)
    await send('EHLO playtest-circle')
    await reply(250)
    await send(`AUTH PLAIN ${b64(`\0${env.SMTP_USER}\0${env.SMTP_PASS}`)}`)
    await reply(235)
    await send(`MAIL FROM:<${env.SMTP_USER}>`)
    await reply(250)
    await send(`RCPT TO:<${mail.to}>`)
    await reply(250)
    await send('DATA')
    await reply(354)
    const body = buildMime(env.SMTP_USER!, env.MAIL_FROM_NAME ?? 'Play Testing Circle', mail).replace(/^\./gm, '..')
    await writer.write(enc.encode(body + '\r\n.\r\n'))
    await reply(250)
    await send('QUIT')
  } finally {
    await socket.close().catch(() => {})
  }
}
