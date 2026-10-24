import { RECORDING, UPLOAD_PART_BYTES } from '@shared/rules'

export interface UploadedPart {
  partNumber: number
  etag: string
}

export class WrongSurfaceError extends Error {
  constructor() {
    super('wrong_surface')
  }
}

const MIME_CANDIDATES = [
  'video/mp4;codecs=avc1.42E01F,opus',
  'video/mp4;codecs=avc1,opus',
  'video/mp4',
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm',
]

export function pickMime(): string {
  return MIME_CANDIDATES.find((m) => MediaRecorder.isTypeSupported(m)) ?? 'video/webm'
}

/** Tab capture with tab audio needs desktop Chromium. */
export function recordingSupported(): boolean {
  const ua = navigator.userAgent
  const mobile = /Android|iPhone|iPad|Mobile/i.test(ua)
  const chromium = /Chrome\/|Edg\//.test(ua) && !/Firefox\//.test(ua)
  return !mobile && chromium && !!navigator.mediaDevices?.getDisplayMedia && typeof MediaRecorder !== 'undefined'
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export interface RecorderOptions {
  withMic: boolean
  /**
   * Microphone stream acquired before the share dialog. Asking afterwards would pop a permission prompt
   * in this tab while Chrome has already switched the tester to the game tab.
   */
  micStream?: MediaStream | null
  /** 'browser' records a game tab; 'window' records a desktop game (e.g. Steam) window or screen. */
  surface?: 'browser' | 'window'
  /** Returns a presigned URL for one multipart part. */
  partUrl: (partNumber: number) => Promise<string>
  onProgress?: (state: { parts: number; uploading: boolean; retrying: boolean }) => void
  /** The tester ended sharing from the browser's own "Stop sharing" bar. */
  onShareEnded?: () => void
}

/**
 * Records one browser tab (whole viewport, all UI) plus optional microphone, and streams the
 * result to object storage as multipart parts while the tester plays.
 */
export class TabRecorder {
  readonly mime = pickMime()
  micFailed = false
  private display?: MediaStream
  private mic?: MediaStream
  private audioCtx?: AudioContext
  private analyser?: AnalyserNode
  private recorder?: MediaRecorder
  private buffer: Blob[] = []
  private bufferedBytes = 0
  private nextPart = 1
  private parts: UploadedPart[] = []
  private queue: Promise<void> = Promise.resolve()
  private startedAt = 0
  private stoppedAt = 0
  private stopping?: Promise<UploadedPart[]>
  private uploadFailed: unknown = null
  /** Last part-upload error, kept so a failed upload can be explained to support. */
  lastUploadError = ''

  constructor(private opts: RecorderOptions) {}

  /** Must be called from a click handler (getDisplayMedia needs a user gesture). */
  async start(): Promise<void> {
    this.display = await navigator.mediaDevices.getDisplayMedia({
      video: {
        displaySurface: this.opts.surface ?? 'browser',
        width: { max: RECORDING.maxWidth },
        height: { max: RECORDING.maxHeight },
        frameRate: { max: RECORDING.frameRate },
      },
      audio: { suppressLocalAudioPlayback: false } as MediaTrackConstraints,
      selfBrowserSurface: 'exclude',
      surfaceSwitching: 'include',
      preferCurrentTab: false,
      systemAudio: 'exclude',
    } as DisplayMediaStreamOptions)

    const video = this.display.getVideoTracks()[0]
    const surface = (video.getSettings() as MediaTrackSettings & { displaySurface?: string }).displaySurface
    if (surface && (this.opts.surface ?? 'browser') === 'browser' && surface !== 'browser') {
      this.release()
      throw new WrongSurfaceError()
    }
    video.addEventListener('ended', () => this.opts.onShareEnded?.())

    if (this.opts.micStream) {
      this.mic = this.opts.micStream
    } else if (this.opts.withMic) {
      try {
        this.mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } })
      } catch {
        this.micFailed = true
      }
    }

    // Mix tab audio and mic into one track; MediaRecorder records only the first audio track.
    const ctx = new AudioContext()
    this.audioCtx = ctx
    await ctx.resume().catch(() => {})
    const dest = ctx.createMediaStreamDestination()
    const tabAudio = this.display.getAudioTracks()[0]
    if (tabAudio) ctx.createMediaStreamSource(new MediaStream([tabAudio])).connect(dest)
    if (this.mic) {
      const src = ctx.createMediaStreamSource(this.mic)
      src.connect(dest)
      this.analyser = ctx.createAnalyser()
      this.analyser.fftSize = 512
      src.connect(this.analyser)
    }
    const tracks = [video, ...(tabAudio || this.mic ? dest.stream.getAudioTracks() : [])]

    this.recorder = new MediaRecorder(new MediaStream(tracks), {
      mimeType: this.mime,
      videoBitsPerSecond: RECORDING.videoBitsPerSecond,
      audioBitsPerSecond: RECORDING.audioBitsPerSecond,
    })
    this.recorder.ondataavailable = (e) => {
      if (e.data.size) {
        this.buffer.push(e.data)
        this.bufferedBytes += e.data.size
      }
      if (this.bufferedBytes >= UPLOAD_PART_BYTES) this.flush()
    }
    this.recorder.start(2000)
    this.startedAt = performance.now()
  }

  /** Milliseconds recorded so far. */
  elapsedMs(): number {
    if (!this.startedAt) return 0
    return Math.round((this.stoppedAt || performance.now()) - this.startedAt)
  }

  /** 0..1 microphone loudness for the level meter. */
  micLevel(): number {
    if (!this.analyser) return 0
    const data = new Uint8Array(this.analyser.fftSize)
    this.analyser.getByteTimeDomainData(data)
    let peak = 0
    for (const v of data) peak = Math.max(peak, Math.abs(v - 128))
    return Math.min(1, peak / 64)
  }

  get hasMic() {
    return !!this.mic
  }

  private flush() {
    if (!this.bufferedBytes) return
    const blob = new Blob(this.buffer, { type: this.mime })
    this.buffer = []
    this.bufferedBytes = 0
    const partNumber = this.nextPart++
    this.queue = this.queue.then(() => this.uploadPart(partNumber, blob))
  }

  private async uploadPart(partNumber: number, blob: Blob) {
    this.opts.onProgress?.({ parts: this.parts.length, uploading: true, retrying: false })
    for (let attempt = 0; ; attempt++) {
      try {
        const url = await this.opts.partUrl(partNumber)
        const res = await fetch(url, { method: 'PUT', body: blob })
        const etag = res.headers.get('etag')
        if (!res.ok || !etag) throw new Error(`part_${res.status}`)
        this.parts.push({ partNumber, etag })
        this.opts.onProgress?.({ parts: this.parts.length, uploading: false, retrying: false })
        return
      } catch (e) {
        this.lastUploadError = `part ${partNumber}, try ${attempt + 1}: ${e instanceof Error ? e.message : String(e)}`.slice(0, 300)
        if (attempt >= 6) {
          this.uploadFailed = e
          return
        }
        this.opts.onProgress?.({ parts: this.parts.length, uploading: true, retrying: true })
        await sleep(Math.min(30_000, 1000 * 2 ** attempt))
      }
    }
  }

  /** Stops recording and resolves once every part is uploaded. Safe to call more than once. */
  stop(): Promise<UploadedPart[]> {
    this.stopping ??= new Promise<UploadedPart[]>((resolve) => {
      const finish = async () => {
        this.flush()
        await this.queue
        this.release()
        resolve([...this.parts].sort((a, b) => a.partNumber - b.partNumber))
      }
      if (!this.recorder || this.recorder.state === 'inactive') {
        void finish()
        return
      }
      this.stoppedAt = performance.now()
      this.recorder.addEventListener('stop', () => void finish(), { once: true })
      this.recorder.stop()
    })
    return this.stopping
  }

  get failed() {
    return this.uploadFailed !== null
  }

  private release() {
    this.display?.getTracks().forEach((t) => t.stop())
    this.mic?.getTracks().forEach((t) => t.stop())
    void this.audioCtx?.close().catch(() => {})
  }
}
