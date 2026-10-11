export interface UploadedPart {
  partNumber: number
  etag: string
}

/** Object storage seen through presigned URLs, so large bodies never pass the Worker in production. */
export interface StorageDriver extends ObjectFetcher {
  putUrl(key: string, ttlSec?: number): Promise<string>
  getUrl(key: string, ttlSec?: number): Promise<string>
  createMultipart(key: string, contentType: string): Promise<string>
  partUrl(key: string, uploadId: string, partNumber: number, ttlSec?: number): Promise<string>
  completeMultipart(key: string, uploadId: string, parts: UploadedPart[]): Promise<void>
  abortMultipart(key: string, uploadId: string): Promise<void>
  /** Parts the storage actually holds for an open upload (source of truth over what the client reports). */
  listParts(key: string, uploadId: string): Promise<UploadedPart[]>
  size(key: string): Promise<number | null>
  delete(key: string): Promise<void>
}

export interface ObjectFetcher {
  /** Streams an object, honouring an HTTP Range header (needed for video seeking). */
  fetchObject(key: string, range: string | null): Promise<Response>
}
