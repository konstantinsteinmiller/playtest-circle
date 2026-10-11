import { Hono } from 'hono'
import { MAX_HOVER_CLIP_BYTES, MAX_IMAGE_BYTES, MAX_SCREENSHOTS } from '../../shared/rules'
import type { GameHost, GameInput } from '../../shared/types'
import { requireUser } from '../auth/session'
import { mapGame, type GameRow } from '../domain'
import type { AppEnv } from '../env'
import { fail, httpUrl, newId, now, str } from '../lib'
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
