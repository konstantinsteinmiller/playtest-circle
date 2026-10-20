import type { Context, MiddlewareHandler } from 'hono'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'
import { GUEST_GRANT, WELCOME_GRANT } from '../../shared/rules'
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
      `SELECT u.id, u.name, u.email, u.role, u.credits, u.banned_at, u.guest, s.expires_at
       FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = ? AND u.deleted_at IS NULL`,
    )
      .bind(hash)
      .first<{ id: string; name: string; email: string; role: 'user' | 'admin'; credits: number; banned_at: number | null; guest: number; expires_at: number }>()
    if (row && row.expires_at > now()) {
      c.set('user', { id: row.id, name: row.name, email: row.email, role: row.role, credits: row.credits, banned: !!row.banned_at, guest: !!row.guest })
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

/** Posting games and campaigns needs a Google account; guests can only browse, test and comment. */
export function requireMember(c: Context<AppEnv>): SessionUser {
  const u = requireUser(c)
  if (u.guest) fail(403, 'google_required')
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

/**
 * A guest account lives only in its session cookie: no Google identity, no email, and only part of the welcome grant.
 * It can test and comment; signing in with Google later keeps everything it earned.
 */
export async function createGuest(env: Env): Promise<string> {
  const id = newId()
  const t = now()
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO users (id, google_sub, email, name, role, credits, email_opt_in, onboarded_at, guest, created_at)
       VALUES (?, ?, '', ?, 'user', ?, 0, ?, 1, ?)`,
    ).bind(id, `guest:${id}`, `Guest ${id.slice(0, 4).toUpperCase()}`, GUEST_GRANT, t, t),
    env.DB.prepare('INSERT INTO credit_ledger (id, user_id, delta, reason, created_at) VALUES (?, ?, ?, ?, ?)').bind(
      newId(),
      id,
      GUEST_GRANT,
      'welcome_grant',
      t,
    ),
  ])
  return id
}

/** Moves a guest's playtests, Credits, reputation, comments and favorites into an existing account and retires the guest. */
async function mergeGuest(env: Env, guestId: string, targetId: string) {
  await env.DB.batch([
    // A campaign both accounts already tested stays with the guest: one playtest per tester and campaign.
    env.DB.prepare('UPDATE OR IGNORE playtests SET tester_id = ? WHERE tester_id = ?').bind(targetId, guestId),
    env.DB.prepare('UPDATE game_comments SET user_id = ? WHERE user_id = ?').bind(targetId, guestId),
    env.DB.prepare('UPDATE OR IGNORE game_favorites SET user_id = ? WHERE user_id = ?').bind(targetId, guestId),
    env.DB.prepare('DELETE FROM game_favorites WHERE user_id = ?').bind(guestId),
    env.DB.prepare('UPDATE notifications SET user_id = ? WHERE user_id = ?').bind(targetId, guestId),
    env.DB.prepare('UPDATE credit_ledger SET user_id = ? WHERE user_id = ?').bind(targetId, guestId),
    // Earned Credits move over; the guest's start grant doesn't, since the account already had its welcome grant.
    env.DB.prepare(
      `UPDATE users SET credits = users.credits + MAX(0, g.credits - ?), rep_up = users.rep_up + g.rep_up, rep_down = users.rep_down + g.rep_down
       FROM (SELECT credits, rep_up, rep_down FROM users WHERE id = ?) AS g WHERE users.id = ?`,
    ).bind(GUEST_GRANT, guestId, targetId),
    env.DB.prepare(
      "UPDATE users SET credits = 0, rep_up = 0, rep_down = 0, name = 'Merged guest', google_sub = 'merged:' || id, deleted_at = ? WHERE id = ?",
    ).bind(now(), guestId),
    env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(guestId),
  ])
}

/**
 * Finds or creates the user for a verified Google identity. New users get the welcome grant.
 * Signed in as a guest, a new identity upgrades that guest in place and a known one absorbs it.
 */
export async function upsertUser(env: Env, id: Identity, guestId: string | null = null): Promise<string> {
  const admins = env.ADMIN_EMAILS.split(',').map((s) => s.trim().toLowerCase())
  const role = admins.includes(id.email.toLowerCase()) ? 'admin' : 'user'
  const existing = await env.DB.prepare('SELECT id FROM users WHERE google_sub = ?').bind(id.sub).first<{ id: string }>()
  if (existing) {
    await env.DB.prepare('UPDATE users SET email = ?, name = ?, avatar_url = ?, role = ? WHERE id = ?')
      .bind(id.email, id.name, id.picture, role, existing.id)
      .run()
    if (guestId && guestId !== existing.id) await mergeGuest(env, guestId, existing.id)
    return existing.id
  }
  const userId = guestId ?? newId()
  const t = now()
  await env.DB.batch([
    guestId
      ? env.DB.prepare(
          `UPDATE users SET google_sub = ?, email = ?, name = ?, avatar_url = ?, role = ?, credits = credits + ?,
             email_opt_in = 1, guest = 0 WHERE id = ?`,
        ).bind(id.sub, id.email, id.name, id.picture, role, WELCOME_GRANT - GUEST_GRANT, guestId)
      : env.DB.prepare(
          'INSERT INTO users (id, google_sub, email, name, avatar_url, role, credits, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        ).bind(userId, id.sub, id.email, id.name, id.picture, role, WELCOME_GRANT, t),
    env.DB.prepare('INSERT INTO credit_ledger (id, user_id, delta, reason, created_at) VALUES (?, ?, ?, ?, ?)').bind(
      newId(),
      userId,
      guestId ? WELCOME_GRANT - GUEST_GRANT : WELCOME_GRANT,
      'welcome_grant',
      t,
    ),
  ])
  return userId
}
