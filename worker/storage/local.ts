import type { Env } from '../env'
import { hmac } from '../lib'
import type { StorageDriver, UploadedPart } from './types'

/**
 * Dev/e2e driver: a local R2 binding behind signed Worker routes (see routes/localStorage.ts).
 * Mirrors the presigned-URL contract of B2 so the client code path is identical.
 */
export class LocalDriver implements StorageDriver {
  constructor(private env: Env, private origin: string) {}

  private async signed(path: string, params: Record<string, string>, ttlSec: number) {
    const exp = String(Math.floor(Date.now() / 1000) + ttlSec)
    const all = { ...params, exp }
    const canonical = Object.keys(all).sort().map((k) => `${k}=${all[k as keyof typeof all]}`).join('&')
    const sig = await hmac(this.env.SESSION_SECRET, `${path}?${canonical}`)
    const u = new URL(`${this.origin}/api/local-storage/${path}`)
    for (const [k, v] of Object.entries(all)) u.searchParams.set(k, v)
    u.searchParams.set('sig', sig)
    return u.toString()
  }

  putUrl(key: string, ttlSec = 900) {
    return this.signed('put', { key }, ttlSec)
  }

  getUrl(key: string, ttlSec = 3600) {
    return this.signed('get', { key }, ttlSec)
  }

  async createMultipart(key: string, contentType: string) {
    const mpu = await this.env.LOCAL_BUCKET.createMultipartUpload(key, { httpMetadata: { contentType } })
    return mpu.uploadId
  }

  partUrl(key: string, uploadId: string, partNumber: number, ttlSec = 900) {
    return this.signed('part', { key, uploadId, part: String(partNumber) }, ttlSec)
  }

  async completeMultipart(key: string, uploadId: string, parts: UploadedPart[]) {
    const mpu = this.env.LOCAL_BUCKET.resumeMultipartUpload(key, uploadId)
    await mpu.complete(parts.sort((a, b) => a.partNumber - b.partNumber))
  }

  async listParts(key: string, uploadId: string) {
    // R2 bindings can't list parts, so the local part route leaves a marker per part.
    const listed = await this.env.LOCAL_BUCKET.list({ prefix: localPartPrefix(uploadId) })
    return Promise.all(
      listed.objects.map(async (o) => {
        const m = JSON.parse((await (await this.env.LOCAL_BUCKET.get(o.key))!.text()) || '{}') as { etag?: string; size?: number }
        return { partNumber: Number(o.key.split('/').pop()), etag: m.etag ?? '', size: m.size ?? 0 }
      }),
    )
  }

  async abortMultipart(key: string, uploadId: string) {
    try {
      await this.env.LOCAL_BUCKET.resumeMultipartUpload(key, uploadId).abort()
    } catch {
      /* already gone */
    }
  }

  async size(key: string) {
    const head = await this.env.LOCAL_BUCKET.head(key)
    return head ? head.size : null
  }

  async delete(key: string) {
    await this.env.LOCAL_BUCKET.delete(key)
  }

  fetchObject(key: string, range: string | null) {
    return r2Response(this.env.LOCAL_BUCKET, key, range)
  }
}

/** Serves an R2 object with single-range support so <video> can seek. */
export const localPartPrefix = (uploadId: string) => `_parts/${uploadId}/`

export async function r2Response(bucket: R2Bucket, key: string, rangeHeader: string | null): Promise<Response> {
  const head = await bucket.head(key)
  if (!head) return new Response('not found', { status: 404 })
  const size = head.size
  const m = rangeHeader ? /^bytes=(\d*)-(\d*)$/.exec(rangeHeader) : null
  const headers = new Headers({ 'accept-ranges': 'bytes', 'content-type': head.httpMetadata?.contentType ?? 'application/octet-stream' })
  if (m && (m[1] || m[2])) {
    const start = m[1] ? Number(m[1]) : Math.max(0, size - Number(m[2]))
    const end = m[1] && m[2] ? Math.min(Number(m[2]), size - 1) : size - 1
    if (start >= size || start > end) return new Response(null, { status: 416, headers: { 'content-range': `bytes */${size}` } })
    const obj = await bucket.get(key, { range: { offset: start, length: end - start + 1 } })
    headers.set('content-range', `bytes ${start}-${end}/${size}`)
    headers.set('content-length', String(end - start + 1))
    return new Response(obj!.body, { status: 206, headers })
  }
  const obj = await bucket.get(key)
  headers.set('content-length', String(size))
  return new Response(obj!.body, { status: 200, headers })
}

export async function verifyLocalSignature(env: Env, path: string, params: URLSearchParams): Promise<boolean> {
  const sig = params.get('sig')
  const exp = Number(params.get('exp'))
  if (!sig || !exp || exp < Date.now() / 1000) return false
  const entries = [...params.entries()].filter(([k]) => k !== 'sig').sort(([a], [b]) => a.localeCompare(b))
  const canonical = entries.map(([k, v]) => `${k}=${v}`).join('&')
  return (await hmac(env.SESSION_SECRET, `${path}?${canonical}`)) === sig
}
