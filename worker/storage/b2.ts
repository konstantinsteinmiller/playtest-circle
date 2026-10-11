import { AwsClient } from 'aws4fetch'
import type { Env } from '../env'
import type { StorageDriver, UploadedPart } from './types'

/** Backblaze B2 through its S3-compatible API. Bucket stays private; every access is presigned. */
export class B2Driver implements StorageDriver {
  private aws: AwsClient
  private base: string

  constructor(env: Env) {
    this.aws = new AwsClient({
      accessKeyId: env.B2_KEY_ID,
      secretAccessKey: env.B2_APP_KEY,
      service: 's3',
      region: env.B2_REGION,
    })
    this.base = `${env.B2_ENDPOINT.replace(/\/$/, '')}/${env.B2_BUCKET}`
  }

  private url(key: string, params: Record<string, string> = {}) {
    const u = new URL(`${this.base}/${key.split('/').map(encodeURIComponent).join('/')}`)
    for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v)
    return u
  }

  private async presign(method: string, u: URL, ttlSec: number) {
    u.searchParams.set('X-Amz-Expires', String(ttlSec))
    const signed = await this.aws.sign(new Request(u, { method }), { aws: { signQuery: true } })
    return signed.url
  }

  putUrl(key: string, ttlSec = 900) {
    return this.presign('PUT', this.url(key), ttlSec)
  }

  getUrl(key: string, ttlSec = 3600) {
    return this.presign('GET', this.url(key), ttlSec)
  }

  async createMultipart(key: string, contentType: string) {
    const res = await this.aws.fetch(this.url(key, { uploads: '' }), { method: 'POST', headers: { 'content-type': contentType } })
    const xml = await res.text()
    const id = /<UploadId>([^<]+)<\/UploadId>/.exec(xml)?.[1]
    if (!res.ok || !id) throw new Error(`b2_create_multipart_failed:${res.status}`)
    return id
  }

  partUrl(key: string, uploadId: string, partNumber: number, ttlSec = 900) {
    return this.presign('PUT', this.url(key, { partNumber: String(partNumber), uploadId }), ttlSec)
  }

  async completeMultipart(key: string, uploadId: string, parts: UploadedPart[]) {
    const body =
      '<CompleteMultipartUpload>' +
      parts
        .sort((a, b) => a.partNumber - b.partNumber)
        .map((p) => `<Part><PartNumber>${p.partNumber}</PartNumber><ETag>${p.etag}</ETag></Part>`)
        .join('') +
      '</CompleteMultipartUpload>'
    const res = await this.aws.fetch(this.url(key, { uploadId }), { method: 'POST', body })
    if (!res.ok) throw new Error(`b2_complete_failed:${res.status}:${await res.text()}`)
  }

  async listParts(key: string, uploadId: string) {
    const parts: UploadedPart[] = []
    let marker = '0'
    for (let page = 0; page < 20; page++) {
      const res = await this.aws.fetch(this.url(key, { uploadId, 'max-parts': '1000', 'part-number-marker': marker }))
      if (!res.ok) throw new Error(`list_parts_${res.status}`)
      const xml = await res.text()
      for (const m of xml.matchAll(/<Part>([\s\S]*?)<\/Part>/g)) {
        const n = /<PartNumber>(\d+)<\/PartNumber>/.exec(m[1])?.[1]
        const etag = /<ETag>([^<]+)<\/ETag>/.exec(m[1])?.[1]?.replace(/&quot;/g, '"')
        if (n && etag) parts.push({ partNumber: Number(n), etag })
      }
      if (!/<IsTruncated>true<\/IsTruncated>/.test(xml)) break
      marker = /<NextPartNumberMarker>(\d+)</.exec(xml)?.[1] ?? marker
    }
    return parts
  }

  async abortMultipart(key: string, uploadId: string) {
    await this.aws.fetch(this.url(key, { uploadId }), { method: 'DELETE' })
  }

  async size(key: string) {
    const res = await this.aws.fetch(this.url(key), { method: 'HEAD' })
    if (!res.ok) return null
    return Number(res.headers.get('content-length') ?? 0)
  }

  async delete(key: string) {
    await this.aws.fetch(this.url(key), { method: 'DELETE' })
  }

  async fetchObject(key: string, range: string | null) {
    const res = await this.aws.fetch(this.url(key), { headers: range ? { range } : {} })
    const headers = new Headers()
    for (const h of ['content-type', 'content-length', 'content-range', 'accept-ranges', 'etag']) {
      const v = res.headers.get(h)
      if (v) headers.set(h, v)
    }
    return new Response(res.body, { status: res.status, headers })
  }
}
