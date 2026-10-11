import type { Context, MiddlewareHandler } from 'hono'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'
import { WELCOME_GRANT } from '../../shared/rules'
import type { AppEnv, Env, SessionUser } from '../env'
import { fail, newId, now, randomToken, sha256 } from '../lib'

export const SESSION_COOKIE = 'ptc_session'
const SESSION_MS = 30 * 24 * 60 * 60 * 1000

export const loadSession: MiddlewareHandler<AppEnv> = async (c, next) => {
  c.set('user', null)
  const token = getCookie(c, SESSION_COOKIE)
  if (token) {
    const hash = await sha256(token)
    const row = await c.env.DB.prepare(
      `SELECT u.id, u.name, u.email, u.role, u.credits, u.banned_at, s.expires_at
       FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = ? AND u.deleted_at IS NULL`,
    )
      .bind(hash)
      .first<{ id: string; name: string; email: string; role: 'user' | 'admin'; credits: number; banned_at: number | null; expires_at: number }>()
    if (row && row.expires_at > now()) {
      c.set('user', { id: row.id, name: row.name, email: row.email, role: row.role, credits: row.credits, banned: !!row.banned_at })
      // Sliding expiry, refreshed at most once a day.
      if (row.expires_at - now() < SESSION_MS - 86_400_000) {
        await c.env.DB.prepare('UPDATE sessions SET expires_at = ? WHERE token_hash = ?').bind(now() + SESSION_MS, hash).run()
      }
    }
  }
  await next()
}

/** Rejects cross-site writes: cookies are SameSite=Lax, this closes the remaining gaps. */
export const checkOrigin: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (!['GET', 'HEAD', 'OPTIONS'].includes(c.req.method)) {
    const origin = c.req.header('origin')
    if (origin && origin !== new URL(c.req.url).origin) fail(403, 'bad_origin')
  }
  await next()
}

export function requireUser(c: Context<AppEnv>): SessionUser {
  const u = c.get('user')
  if (!u) fail(401, 'unauthenticated')
  if (u.banned) fail(403, 'banned')
  return u
}

export function requireAdmin(c: Context<AppEnv>): SessionUser {
  const u = requireUser(c)
  if (u.role !== 'admin') fail(403, 'forbidden')
  return u
}

export async function startSession(c: Context<AppEnv>, userId: string) {
  const token = randomToken()
  await c.env.DB.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)')
    .bind(await sha256(token), userId, now() + SESSION_MS)
    .run()
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    secure: new URL(c.req.url).protocol === 'https:',
    sameSite: 'Lax',
    path: '/',
    maxAge: SESSION_MS / 1000,
  })
}

export async function endSession(c: Context<AppEnv>) {
  const token = getCookie(c, SESSION_COOKIE)
  if (token) await c.env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(await sha256(token)).run()
  deleteCookie(c, SESSION_COOKIE, { path: '/' })
}

export interface Identity {
  sub: string
  email: string
  name: string
  picture: string | null
}

/** Finds or creates the user for a verified Google identity. New users get the welcome grant. */
export async function upsertUser(env: Env, id: Identity): Promise<string> {
  const admins = env.ADMIN_EMAILS.split(',').map((s) => s.trim().toLowerCase())
  const role = admins.includes(id.email.toLowerCase()) ? 'admin' : 'user'
  const existing = await env.DB.prepare('SELECT id FROM users WHERE google_sub = ?').bind(id.sub).first<{ id: string }>()
  if (existing) {
    await env.DB.prepare('UPDATE users SET email = ?, name = ?, avatar_url = ?, role = ? WHERE id = ?')
      .bind(id.email, id.name, id.picture, role, existing.id)
      .run()
    return existing.id
  }
  const userId = newId()
  const t = now()
  await env.DB.batch([
    env.DB.prepare(
      'INSERT INTO users (id, google_sub, email, name, avatar_url, role, credits, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    ).bind(userId, id.sub, id.email, id.name, id.picture, role, WELCOME_GRANT, t),
    env.DB.prepare('INSERT INTO credit_ledger (id, user_id, delta, reason, created_at) VALUES (?, ?, ?, ?, ?)').bind(
      newId(),
      userId,
      WELCOME_GRANT,
      'welcome_grant',
      t,
    ),
  ])
  return userId
}
