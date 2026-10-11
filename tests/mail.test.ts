import { describe, expect, it } from 'vitest'
import { buildMime } from '../worker/mail'

describe('buildMime', () => {
  it('encodes UTF-8 subject and bodies and keeps lines short', () => {
    const mime = buildMime('bot@example.com', 'Play Testing Circle', {
      to: 'dev@example.com',
      subject: 'Neuer Playtest für Dämon-Dash',
      text: 'Hallo ✨',
      html: '<p>Hallo ✨</p>',
    })
    expect(mime).toContain('To: <dev@example.com>')
    expect(mime).toMatch(/^Subject: =\?UTF-8\?B\?[A-Za-z0-9+/=]+\?=$/m)
    expect(mime).toContain('Content-Type: multipart/alternative')
    for (const line of mime.split('\r\n')) expect(line.length).toBeLessThanOrEqual(998)
    const subject = /^Subject: =\?UTF-8\?B\?(.+)\?=$/m.exec(mime)![1]
    expect(Buffer.from(subject, 'base64').toString('utf8')).toBe('Neuer Playtest für Dämon-Dash')
  })
})
