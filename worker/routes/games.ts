import { Hono } from 'hono'
import { COMMENT_RATE, MAX_COMMENT_LENGTH, MAX_HOVER_CLIP_BYTES, MAX_IMAGE_BYTES, MAX_SCREENSHOTS } from '../../shared/rules'
import type { CampaignCard, GameCard, GameComment, GameHost, GameInput, GamePage } from '../../shared/types'
import { requireUser } from '../auth/session'
import { CAMPAIGN_FROM, CAMPAIGN_SELECT, mapCampaignCard, mapGame, type CampaignRow, type GameRow } from '../domain'
import type { AppEnv } from '../env'
import { fail, httpUrl, newId, now, str } from '../lib'
import { notify } from '../notify'
import { storage } from '../storage'

export const gameRoutes = new Hono<AppEnv>()

const HOSTS: GameHost[] = ['itch', 'steam', 'wavedash', 'crazygames', 'newgrounds', 'own', 'other']
const IMAGE_TYPES = ['image/webp', 'image/png', 'image/jpeg']
const CLIP_TYPES = ['video/mp4']

/** A media key is only accepted if the caller uploaded it themselves. */
function ownKey(userId: string, key: unknown): string | null {
  if (key === null || key === undefined || key === '') return null
  if (typeof key !== 'string' || !key.startsWith(`media/${userId}/`) || key.includes('..')) fail(422, 'invalid_media_key')
  return key
}

function trailerUrl(v: unknown): string | null {
  if (!v) return null
  const u = new URL(httpUrl(v))
  const ok = /(^|\.)youtube\.com$|^youtu\.be$|(^|\.)vimeo\.com$/.test(u.hostname) || /\.(mp4|webm)$/i.test(u.pathname)
  if (!ok) fail(422, 'invalid_trailer_url')
  return u.toString()
}

function parseGame(userId: string, b: Partial<GameInput>) {
  const tags = Array.isArray(b.tags) ? b.tags.slice(0, 8).map((t) => str(t, 24, 1).toLowerCase()) : []
  const shots = Array.isArray(b.screenshotKeys) ? b.screenshotKeys.map((k) => ownKey(userId, k)!).filter(Boolean) : []
  if (shots.length > MAX_SCREENSHOTS) fail(422, 'too_many_screenshots')
  const host = HOSTS.includes(b.host as GameHost) ? (b.host as GameHost) : 'other'
  return {
    title: str(b.title, 80, 2),
    pitch: str(b.pitch, 160, 10),
    description: str(b.description ?? '', 4000),
    tags: JSON.stringify([...new Set(tags)]),
    playUrl: httpUrl(b.playUrl),
    host,
    accessNotes: str(b.accessNotes ?? '', 500),
    trailerUrl: trailerUrl(b.trailerUrl),
    coverKey: ownKey(userId, b.coverKey),
    hoverClipKey: ownKey(userId, b.hoverClipKey),
    screenshots: JSON.stringify(shots),
  }
}

gameRoutes.get('/', async (c) => {
  const u = requireUser(c)
  const { results } = await c.env.DB.prepare('SELECT * FROM games WHERE owner_id = ? AND archived_at IS NULL ORDER BY updated_at DESC')
    .bind(u.id)
    .all<GameRow>()
  return c.json({ games: results.map(mapGame) })
})

/** Open paid playtests per game: live, visible campaigns that still have a free slot. */
async function openCampaigns(db: D1Database, gameId?: string): Promise<CampaignCard[]> {
  const { results } = await db
    .prepare(`SELECT ${CAMPAIGN_SELECT} ${CAMPAIGN_FROM} WHERE c.status = 'live' AND c.hidden_at IS NULL ${gameId ? 'AND c.game_id = ?' : ''} ORDER BY c.price DESC`)
    .bind(...(gameId ? [gameId] : []))
    .all<CampaignRow>()
  return results.map(mapCampaignCard).filter((x) => x.slotsLeft > 0)
}

/** Public catalog of every game, with or without a paid playtest. Needs no account. */
gameRoutes.get('/catalog', async (c) => {
  const q = (c.req.query('q') ?? '').toLowerCase().replace(/[%_]/g, '').trim()
  const { results } = await c.env.DB.prepare(
    `SELECT g.*, u.name AS u_name,
       (SELECT COUNT(*) FROM game_comments gc WHERE gc.game_id = g.id AND gc.deleted_at IS NULL) AS comment_count
     FROM games g JOIN users u ON u.id = g.owner_id
     WHERE g.archived_at IS NULL AND u.deleted_at IS NULL AND u.banned_at IS NULL
       ${q ? 'AND (lower(g.title) LIKE ?1 OR lower(g.pitch) LIKE ?1)' : ''}
     ORDER BY g.updated_at DESC LIMIT 200`,
  )
    .bind(...(q ? [`%${q}%`] : []))
    .all<GameRow & { u_name: string; comment_count: number }>()
  const open = await openCampaigns(c.env.DB)
  const games: GameCard[] = results.map((r) => {
    const mine = open.filter((x) => x.game.id === r.id)
    const g = mapGame(r)
    return {
      id: g.id,
      title: g.title,
      pitch: g.pitch,
      tags: g.tags,
      host: g.host,
      coverUrl: g.coverUrl,
      hoverClipUrl: g.hoverClipUrl,
      owner: { id: r.owner_id, name: r.u_name },
      openPlaytests: mine.length,
      topPrice: Math.max(0, ...mine.map((x) => x.price)),
      comments: r.comment_count,
    }
  })
  // Games with a paid playtest first, the rest by last update.
  games.sort((a, b) => Number(b.openPlaytests > 0) - Number(a.openPlaytests > 0))
  return c.json({ games })
})

/** Public game page: details, open paid playtests and comments. */
gameRoutes.get('/:id/page', async (c) => {
  const viewer = c.get('user')
  const r = await c.env.DB.prepare(
    `SELECT g.*, u.name AS u_name, u.avatar_url AS u_avatar_url, u.rep_up AS u_rep_up, u.rep_down AS u_rep_down
     FROM games g JOIN users u ON u.id = g.owner_id WHERE g.id = ? AND g.archived_at IS NULL AND u.deleted_at IS NULL`,
  )
    .bind(c.req.param('id'))
    .first<GameRow & { u_name: string; u_avatar_url: string | null; u_rep_up: number; u_rep_down: number }>()
  if (!r) fail(404, 'not_found')
  const { results } = await c.env.DB.prepare(
    `SELECT gc.id, gc.text, gc.created_at, gc.user_id, u.name, u.avatar_url, u.guest
     FROM game_comments gc JOIN users u ON u.id = gc.user_id
     WHERE gc.game_id = ? AND gc.deleted_at IS NULL ORDER BY gc.created_at DESC LIMIT 200`,
  )
    .bind(r.id)
    .all<{ id: string; text: string; created_at: number; user_id: string; name: string; avatar_url: string | null; guest: number }>()
  const comments: GameComment[] = results.map((x) => ({
    id: x.id,
    text: x.text,
    createdAt: x.created_at,
    author: { id: x.user_id, name: x.name, avatarUrl: x.avatar_url, guest: !!x.guest },
    canDelete: !!viewer && (viewer.id === x.user_id || viewer.id === r.owner_id || viewer.role === 'admin'),
  }))
  const page: GamePage = {
    game: mapGame(r),
    owner: { id: r.owner_id, name: r.u_name, avatarUrl: r.u_avatar_url, repUp: r.u_rep_up, repDown: r.u_rep_down },
    campaigns: await openCampaigns(c.env.DB, r.id),
    comments,
  }
  return c.json(page)
})

gameRoutes.post('/:id/comments', async (c) => {
  const u = requireUser(c)
  const game = await c.env.DB.prepare('SELECT id, owner_id, title FROM games WHERE id = ? AND archived_at IS NULL')
    .bind(c.req.param('id'))
    .first<{ id: string; owner_id: string; title: string }>()
  if (!game) fail(404, 'not_found')
  const text = str(((await c.req.json()) as { text?: unknown }).text, MAX_COMMENT_LENGTH, 2)
  const t = now()
  const recent = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM game_comments WHERE user_id = ? AND created_at > ?')
    .bind(u.id, t - COMMENT_RATE.windowMs)
    .first<{ n: number }>()
  if ((recent?.n ?? 0) >= COMMENT_RATE.max) fail(429, 'too_many_comments')
  const id = newId()
  await c.env.DB.prepare('INSERT INTO game_comments (id, game_id, user_id, text, created_at) VALUES (?, ?, ?, ?, ?)')
    .bind(id, game.id, u.id, text, t)
    .run()
  if (game.owner_id !== u.id) {
    c.executionCtx.waitUntil(
      notify(c.env, game.owner_id, 'game_comment', { game: game.title, author: u.name }, `/g/${game.id}`).catch((e) => console.error('[notify]', e)),
    )
  }
  return c.json({ id })
})

gameRoutes.delete('/:id/comments/:commentId', async (c) => {
  const u = requireUser(c)
  const row = await c.env.DB.prepare(
    'SELECT gc.user_id, g.owner_id FROM game_comments gc JOIN games g ON g.id = gc.game_id WHERE gc.id = ? AND gc.game_id = ?',
  )
    .bind(c.req.param('commentId'), c.req.param('id'))
    .first<{ user_id: string; owner_id: string }>()
  if (!row) fail(404, 'not_found')
  if (row.user_id !== u.id && row.owner_id !== u.id && u.role !== 'admin') fail(403, 'forbidden')
  await c.env.DB.prepare('UPDATE game_comments SET deleted_at = COALESCE(deleted_at, ?) WHERE id = ?').bind(now(), c.req.param('commentId')).run()
  return c.json({ ok: true })
})

gameRoutes.get('/:id', async (c) => {
  const u = requireUser(c)
  const r = await c.env.DB.prepare('SELECT * FROM games WHERE id = ?').bind(c.req.param('id')).first<GameRow>()
  if (!r || r.owner_id !== u.id) fail(404, 'not_found')
  const raw = { coverKey: r.cover_key, hoverClipKey: r.hover_clip_key, screenshotKeys: JSON.parse(r.screenshots) as string[] }
  return c.json({ game: mapGame(r), keys: raw })
})

gameRoutes.post('/', async (c) => {
  const u = requireUser(c)
  const g = parseGame(u.id, await c.req.json())
  const id = newId()
  const t = now()
  await c.env.DB.prepare(
    `INSERT INTO games (id, owner_id, title, pitch, description, tags, play_url, host, access_notes, trailer_url,
      cover_key, hover_clip_key, screenshots, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  )
    .bind(id, u.id, g.title, g.pitch, g.description, g.tags, g.playUrl, g.host, g.accessNotes, g.trailerUrl, g.coverKey, g.hoverClipKey, g.screenshots, t, t)
    .run()
  return c.json({ id })
})

gameRoutes.put('/:id', async (c) => {
  const u = requireUser(c)
  const id = c.req.param('id')
  const owner = await c.env.DB.prepare('SELECT owner_id FROM games WHERE id = ?').bind(id).first<{ owner_id: string }>()
  if (!owner || owner.owner_id !== u.id) fail(404, 'not_found')
  const g = parseGame(u.id, await c.req.json())
  await c.env.DB.prepare(
    `UPDATE games SET title=?, pitch=?, description=?, tags=?, play_url=?, host=?, access_notes=?, trailer_url=?,
      cover_key=?, hover_clip_key=?, screenshots=?, updated_at=? WHERE id=?`,
  )
    .bind(g.title, g.pitch, g.description, g.tags, g.playUrl, g.host, g.accessNotes, g.trailerUrl, g.coverKey, g.hoverClipKey, g.screenshots, now(), id)
    .run()
  return c.json({ id })
})

gameRoutes.delete('/:id', async (c) => {
  const u = requireUser(c)
  const id = c.req.param('id')
  const live = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM campaigns WHERE game_id = ? AND status IN ('live','paused')")
    .bind(id)
    .first<{ n: number }>()
  if (live && live.n > 0) fail(409, 'game_has_live_campaigns')
  await c.env.DB.prepare('UPDATE games SET archived_at = ? WHERE id = ? AND owner_id = ?').bind(now(), id, u.id).run()
  return c.json({ ok: true })
})

/** Presigned upload for a cover, screenshot or hover clip. The client PUTs the file body itself. */
gameRoutes.post('/media-upload', async (c) => {
  const u = requireUser(c)
  const b = (await c.req.json()) as { kind: 'image' | 'clip'; contentType: string; size: number }
  const isImage = b.kind === 'image'
  const types = isImage ? IMAGE_TYPES : CLIP_TYPES
  if (!types.includes(b.contentType)) fail(422, 'unsupported_type')
  if (!(b.size > 0) || b.size > (isImage ? MAX_IMAGE_BYTES : MAX_HOVER_CLIP_BYTES)) fail(413, 'too_large')
  const ext = b.contentType.split('/')[1].replace('jpeg', 'jpg')
  const key = `media/${u.id}/${newId()}.${ext}`
  const putUrl = await storage(c.env, new URL(c.req.url).origin).putUrl(key)
  return c.json({ key, putUrl, url: `/api/media/${key}` })
})
