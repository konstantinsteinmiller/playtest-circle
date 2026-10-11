export class ApiError extends Error {
  constructor(public status: number, public code: string) {
    super(code)
  }
}

export async function api<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, ...rest } = init
  const res = await fetch(`/api${path}`, {
    credentials: 'same-origin',
    ...rest,
    headers: { ...(json !== undefined ? { 'content-type': 'application/json' } : {}), ...(rest.headers ?? {}) },
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  })
  if (!res.ok) {
    let code = 'unknown_error'
    try {
      code = ((await res.json()) as { error?: string }).error ?? code
    } catch {
      /* not json */
    }
    throw new ApiError(res.status, code)
  }
  return (await res.json()) as T
}

/** PUT a file body to a presigned URL (B2 in production, the local driver in dev). */
export async function putToUrl(url: string, body: Blob, contentType: string): Promise<Response> {
  const res = await fetch(url, { method: 'PUT', body, headers: { 'content-type': contentType } })
  if (!res.ok) throw new ApiError(res.status, 'upload_failed')
  return res
}
