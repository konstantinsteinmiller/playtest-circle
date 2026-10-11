import { Hono } from 'hono'
import type { AppEnv } from '../env'
import { b64url, b64urlDecode, fail, now, randomToken } from '../lib'
import { endSession, startSession, upsertUser } from './session'

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const TOKEN_URL = 'https://oauth2.googleapis.com/token'

export const authRoutes = new Hono<AppEnv>()

const redirectUri = (reqUrl: string) => `${new URL(reqUrl).origin}/api/auth/google/callback`

/** Only same-site relative paths, so the login can never become an open redirect. */
const safeReturn = (p: string | undefined) => (p && p.startsWith('/') && !p.startsWith('//') ? p : '/browse')

authRoutes.get('/google/start', async (c) => {
  if (!c.env.GOOGLE_CLIENT_ID) fail(400, 'google_not_configured')
  const state = randomToken(16)
  const verifier = randomToken(32)
  const challenge = b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)))
  await c.env.DB.prepare('INSERT INTO oauth_states (state, verifier, return_to, expires_at) VALUES (?, ?, ?, ?)')
    .bind(state, verifier, safeReturn(c.req.query('returnTo')), now() + 10 * 60_000)
    .run()
  const u = new URL(AUTH_URL)
  u.search = new URLSearchParams({
    client_id: c.env.GOOGLE_CLIENT_ID,
    redirect_uri: redirectUri(c.req.url),
    response_type: 'code',
    scope: 'openid email profile',
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    prompt: 'select_account',
  }).toString()
  return c.redirect(u.toString())
})

authRoutes.get('/google/callback', async (c) => {
  const { code, state, error } = c.req.query()
  if (error) return c.redirect(`/?login_error=${encodeURIComponent(error)}`)
  if (!code || !state) fail(400, 'missing_code')
  const row = await c.env.DB.prepare('DELETE FROM oauth_states WHERE state = ? RETURNING verifier, return_to, expires_at')
    .bind(state)
    .first<{ verifier: string; return_to: string; expires_at: number }>()
  if (!row || row.expires_at < now()) return c.redirect('/?login_error=state')

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: c.env.GOOGLE_CLIENT_ID,
      client_secret: c.env.GOOGLE_CLIENT_SECRET,
      redirect_uri: redirectUri(c.req.url),
      grant_type: 'authorization_code',
      code_verifier: row.verifier,
    }),
  })
  if (!res.ok) return c.redirect('/?login_error=token')
  const tokens = (await res.json()) as { id_token?: string }
  if (!tokens.id_token) return c.redirect('/?login_error=token')

  // The ID token came straight from Google's token endpoint over TLS, authenticated with our
  // client secret, so per OIDC Core 3.1.3.7 its claims can be validated without a JWKS check.
  const claims = JSON.parse(b64urlDecode(tokens.id_token.split('.')[1])) as {
    iss: string
    aud: string
    exp: number
    sub: string
    email: string
    email_verified: boolean
    name?: string
    picture?: string
  }
  const issOk = claims.iss === 'https://accounts.google.com' || claims.iss === 'accounts.google.com'
  if (!issOk || claims.aud !== c.env.GOOGLE_CLIENT_ID || claims.exp * 1000 < now() || !claims.email_verified) {
    return c.redirect('/?login_error=claims')
  }
  const userId = await upsertUser(c.env, {
    sub: claims.sub,
    email: claims.email,
    name: claims.name ?? claims.email.split('@')[0],
    picture: claims.picture ?? null,
  })
  const banned = await c.env.DB.prepare('SELECT banned_at FROM users WHERE id = ?').bind(userId).first<{ banned_at: number | null }>()
  if (banned?.banned_at) return c.redirect('/?login_error=banned')
  await startSession(c, userId)
  return c.redirect(row.return_to)
})

authRoutes.post('/logout', async (c) => {
  await endSession(c)
  return c.json({ ok: true })
})

/** Local development and e2e only. Disabled unless DEV_LOGIN=1, which production never sets. */
authRoutes.post('/dev-login', async (c) => {
  if (c.env.DEV_LOGIN !== '1') fail(404, 'not_found')
  const body = (await c.req.json()) as { email?: string; name?: string }
  const email = (body.email ?? 'dev@example.com').toLowerCase()
  const userId = await upsertUser(c.env, { sub: `dev:${email}`, email, name: body.name ?? email.split('@')[0], picture: null })
  await startSession(c, userId)
  return c.json({ ok: true, userId })
})
