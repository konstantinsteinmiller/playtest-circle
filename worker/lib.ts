import { HTTPException } from 'hono/http-exception'

export const now = () => Date.now()

export function newId(): string {
  const b = crypto.getRandomValues(new Uint8Array(12))
  return [...b].map((x) => x.toString(36).padStart(2, '0')).join('').slice(0, 20)
}

export function randomToken(bytes = 32): string {
  return b64url(crypto.getRandomValues(new Uint8Array(bytes)))
}

export function b64url(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf)
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function b64urlDecode(s: string): string {
  const pad = s.length % 4 ? '='.repeat(4 - (s.length % 4)) : ''
  return atob(s.replace(/-/g, '+').replace(/_/g, '/') + pad)
}

export async function sha256(input: string): Promise<string> {
  return b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input)))
}

export async function hmac(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return b64url(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data)))
}

export function fail(status: 400 | 401 | 403 | 404 | 409 | 413 | 422 | 429, code: string): never {
  throw new HTTPException(status, { message: code })
}

export function parseJson<T>(s: string | null | undefined, fallback: T): T {
  if (!s) return fallback
  try {
    return JSON.parse(s) as T
  } catch {
    return fallback
  }
}

export function str(v: unknown, max: number, min = 0): string {
  if (typeof v !== 'string') fail(422, 'invalid_string')
  const t = v.trim()
  if (t.length < min || t.length > max) fail(422, 'invalid_length')
  return t
}

export function httpUrl(v: unknown): string {
  const s = str(v, 2000, 8)
  let u: URL
  try {
    u = new URL(s)
  } catch {
    fail(422, 'invalid_url')
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') fail(422, 'invalid_url')
  return u.toString()
}
