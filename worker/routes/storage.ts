import { Hono } from 'hono'
import type { AppEnv } from '../env'
import { fail } from '../lib'
import { storage } from '../storage'
import { localPartPrefix, r2Response, verifyLocalSignature } from '../storage/local'

export const storageRoutes = new Hono<AppEnv>()

/**
 * Public game media (covers, screenshots, hover clips) behind a stable, cacheable URL.
 * Recordings are never served here: they only leave storage through short-lived presigned URLs.
 */
storageRoutes.get('/media/*', async (c) => {
  const key = decodeURIComponent(new URL(c.req.url).pathname.replace(/^\/api\/media\//, ''))
  if (!key.startsWith('media/') || key.includes('..')) fail(404, 'not_found')
  const range = c.req.header('range') ?? null
  const cache = (caches as unknown as { default: Cache }).default
  const cacheKey = new Request(new URL(`/api/media/${key}`, c.req.url).toString())
  if (!range) {
    const hit = await cache.match(cacheKey)
    if (hit) return hit
  }
  const res = await storage(c.env, new URL(c.req.url).origin).fetchObject(key, range)
  if (!res.ok) return new Response('not found', { status: 404 })
  const out = new Response(res.body, res)
  // Keys are content-addressed by a fresh id on every upload, so they never change.
  out.headers.set('cache-control', 'public, max-age=31536000, immutable')
  out.headers.set('x-content-type-options', 'nosniff')
  if (!range && res.status === 200) c.executionCtx.waitUntil(cache.put(cacheKey, out.clone()))
  return out
})

// ---- Local driver endpoints (dev / e2e). They mimic B2's presigned URLs.

function localOnly(env: AppEnv['Bindings']) {
  if (env.STORAGE_DRIVER === 'b2') fail(404, 'not_found')
}

storageRoutes.put('/local-storage/put', async (c) => {
  localOnly(c.env)
  const q = new URL(c.req.url).searchParams
  if (!(await verifyLocalSignature(c.env, 'put', q))) fail(403, 'bad_signature')
  await c.env.LOCAL_BUCKET.put(q.get('key')!, await c.req.arrayBuffer(), {
    httpMetadata: { contentType: c.req.header('content-type') ?? 'application/octet-stream' },
  })
  return c.body(null, 200)
})

storageRoutes.get('/local-storage/get', async (c) => {
  localOnly(c.env)
  const q = new URL(c.req.url).searchParams
  if (!(await verifyLocalSignature(c.env, 'get', q))) fail(403, 'bad_signature')
  return r2Response(c.env.LOCAL_BUCKET, q.get('key')!, c.req.header('range') ?? null)
})

storageRoutes.put('/local-storage/part', async (c) => {
  localOnly(c.env)
  const q = new URL(c.req.url).searchParams
  if (!(await verifyLocalSignature(c.env, 'part', q))) fail(403, 'bad_signature')
  const mpu = c.env.LOCAL_BUCKET.resumeMultipartUpload(q.get('key')!, q.get('uploadId')!)
  const part = await mpu.uploadPart(Number(q.get('part')), await c.req.arrayBuffer())
  await c.env.LOCAL_BUCKET.put(`${localPartPrefix(q.get('uploadId')!)}${q.get('part')}`, part.etag)
  return c.body(null, 200, { etag: part.etag, 'access-control-expose-headers': 'ETag' })
})
