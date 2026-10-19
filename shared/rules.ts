// Economy and playtest rules shared by the SPA and the Worker.
// Every number that decides Credits lives here so both sides agree.

export const WELCOME_GRANT = 10
export const PRICE_MIN = 5
export const PRICE_MAX = 100
export const SLOTS_MIN = 1
export const SLOTS_MAX = 50
export const TIDY_BONUS = 1
export const TIDY_WINDOW_MS = 24 * 60 * 60 * 1000
export const RECORDING_TTL_MS = 3 * 24 * 60 * 60 * 1000
export const EXPIRY_WARNING_MS = 24 * 60 * 60 * 1000
export const RECORDING_QUOTA_BYTES = 1.5 * 1024 ** 3
/** Global budget for all recordings together (B2 free tier is 10 GB; keep headroom for media). */
export const STORAGE_BUDGET_BYTES = 9 * 1024 ** 3
export const MAX_CUSTOM_QUESTIONS = 5
export const MAX_SCREENSHOTS = 8
export const MAX_IMAGE_BYTES = 2 * 1024 ** 2
export const MAX_HOVER_CLIP_BYTES = 20 * 1024 ** 2
export const MAX_NOTE_LENGTH = 500
export const MAX_COMMENT_LENGTH = 1000
/** Comments one account may post per window, so a guest can't flood a game page. */
export const COMMENT_RATE = { max: 5, windowMs: 10 * 60 * 1000 }
export const MAX_ANSWER_TEXT = 4000

/** Multipart part size. S3/B2 require >= 5 MB for every part but the last. */
export const UPLOAD_PART_BYTES = 5 * 1024 * 1024

/** Recorder targets: ~8 MB/min keeps 50 devs inside the B2 free tier. */
export const RECORDING = {
  maxWidth: 1280,
  maxHeight: 720,
  frameRate: 30,
  videoBitsPerSecond: 1_000_000,
  audioBitsPerSecond: 64_000,
} as const

/**
 * Lowest believable bytes per minute of recording. A static tab at 1 Mbps still
 * produces keyframes; anything far below this means the recording is not real.
 */
export const MIN_BYTES_PER_MINUTE = 40 * 1024

export const PRICE_PRESETS = [
  { id: 'whenever', price: 5 },
  { id: 'normal', price: 10 },
  { id: 'soon', price: 20 },
  { id: 'urgent', price: 40 },
] as const
export type PricePresetId = (typeof PRICE_PRESETS)[number]['id']

export const DEVICE_TARGETS = ['desktop', 'desktop_mobile'] as const
export type DeviceTarget = (typeof DEVICE_TARGETS)[number]

export const PLAYTIME_PRESETS = [
  { id: 'quick', minMinutes: 3, targetMinutes: 5 },
  { id: 'standard', minMinutes: 7, targetMinutes: 10 },
  { id: 'deep', minMinutes: 15, targetMinutes: 20 },
  { id: 'open', minMinutes: 5, targetMinutes: null },
] as const
export type PlaytimePresetId = (typeof PLAYTIME_PRESETS)[number]['id']

export function playtimePreset(id: string) {
  return PLAYTIME_PRESETS.find((p) => p.id === id)
}

export function pricePresetFor(price: number): PricePresetId | null {
  return PRICE_PRESETS.find((p) => p.price === price)?.id ?? null
}

/** How long a started-but-not-submitted playtest keeps its slot. */
export function reservationMs(minMinutes: number): number {
  return Math.max(60, minMinutes * 3) * 60 * 1000
}

export function escrowFor(slots: number, price: number): number {
  return slots * price
}

export function validatePrice(price: number): boolean {
  return Number.isInteger(price) && price >= PRICE_MIN && price <= PRICE_MAX
}

export function validateSlots(slots: number): boolean {
  return Number.isInteger(slots) && slots >= SLOTS_MIN && slots <= SLOTS_MAX
}

/** A tester may stop up to this many minutes before the minimum and still earn, if they explain why. */
export const QUIT_GRACE_MINUTES = 1
/** Characters the early-quit explanation needs to unlock the grace window. */
export const QUIT_REASON_MIN_CHARS = 60

/** Stopped short of the minimum, but inside the grace window that a long enough quit reason can unlock. */
export function inQuitGrace(playedMs: number, minMinutes: number, minuteMs = 60_000): boolean {
  return playedMs < minMinutes * minuteMs && playedMs >= (minMinutes - QUIT_GRACE_MINUTES) * minuteMs
}

export type PayoutReason = 'paid' | 'quit_early' | 'incomplete' | 'no_recording' | 'implausible_recording' | 'interrupted'

export interface PayoutInput {
  minMinutes: number
  /** Server-measured time between recording start and stop. */
  activeMs: number
  /** Duration the client recorder reported. */
  recorderMs: number
  recordingBytes: number
  uploadComplete: boolean
  requiredCount: number
  requiredAnswered: number
  /** Trimmed length of the "why did you stop early" answer. */
  quitReasonChars?: number
  /** Length of a "minute" in ms. Only e2e shortens it. */
  minuteMs?: number
}

/**
 * Decides whether a submitted playtest earns its Credits.
 * The shorter of server time and recorder time counts, so neither side alone can inflate it.
 */
export function evaluatePayout(i: PayoutInput): PayoutReason {
  if (!i.uploadComplete || i.recordingBytes <= 0) return 'no_recording'
  const playedMs = Math.min(i.activeMs, i.recorderMs)
  const minuteMs = i.minuteMs ?? 60_000
  const minutes = playedMs / minuteMs
  if (i.recordingBytes < MIN_BYTES_PER_MINUTE * (playedMs / 60_000) * 0.5) return 'implausible_recording'
  const excused = inQuitGrace(playedMs, i.minMinutes, minuteMs) && (i.quitReasonChars ?? 0) >= QUIT_REASON_MIN_CHARS
  if (minutes < i.minMinutes && !excused) return 'quit_early'
  if (i.requiredAnswered < i.requiredCount) return 'incomplete'
  return 'paid'
}

export function canClaimTidyBonus(submittedAt: number, now: number): boolean {
  return now - submittedAt <= TIDY_WINDOW_MS
}

/** Reputation shown on profiles: Wilson-ish smoothing so 1/1 is not "100 %". */
export function reputationScore(up: number, down: number): number {
  return Math.round(((up + 1) / (up + down + 2)) * 100)
}

export interface EvictionCandidate {
  id: string
  bytes: number
  submittedAt: number
  /** When the game dev first opened the recording; null if never watched. */
  viewedAt: number | null
}

/**
 * When the global recording budget would overflow, free space in this order:
 * already-watched recordings oldest first, then unwatched recordings oldest first.
 */
export function pickEvictions(
  candidates: EvictionCandidate[],
  totalBytes: number,
  incomingBytes: number,
  budget = STORAGE_BUDGET_BYTES,
): string[] {
  let overflow = totalBytes + incomingBytes - budget
  if (overflow <= 0) return []
  const ordered = [...candidates].sort((a, b) => {
    const seenA = a.viewedAt !== null ? 0 : 1
    const seenB = b.viewedAt !== null ? 0 : 1
    return seenA - seenB || a.submittedAt - b.submittedAt
  })
  const out: string[] = []
  for (const c of ordered) {
    if (overflow <= 0) break
    out.push(c.id)
    overflow -= c.bytes
  }
  return out
}

/** Credits per minute of playtime that we consider a fair trade between devs. */
export const FAIR_CREDITS_PER_MINUTE = 2

export type PriceTier = 'low' | 'under' | 'fair' | 'fast'

/** How a price compares with the fair rate for the playtime the dev asks for. */
export function priceAdvice(price: number, preset: PlaytimePresetId) {
  const p = PLAYTIME_PRESETS.find((x) => x.id === preset) ?? PLAYTIME_PRESETS[0]
  const minutes = p.targetMinutes ?? p.minMinutes * 2
  const fair = Math.max(PRICE_MIN, Math.round(minutes * FAIR_CREDITS_PER_MINUTE))
  const fast = Math.min(PRICE_MAX, Math.ceil(fair * 1.5))
  const tier: PriceTier = price < fair * 0.6 ? 'low' : price < fair ? 'under' : price < fast ? 'fair' : 'fast'
  return { fair, fast, tier }
}

/**
 * Multipart parts usable as a video: the unbroken run from part 1. A gap (a part that never arrived)
 * would corrupt everything after it, so later parts are dropped.
 */
export function contiguousParts<T extends { partNumber: number }>(parts: T[]): T[] {
  const byNumber = new Map(parts.map((p) => [p.partNumber, p]))
  const out: T[] = []
  for (let n = 1; byNumber.has(n); n++) out.push(byNumber.get(n)!)
  return out
}

/** End of 20 Oct 2026, Berlin time (CEST, UTC+2): testing-period promos stop here. */
export const TESTING_PERIOD_END = Date.UTC(2026, 9, 20, 22, 0, 0)

/** Testing-period cheat (?cheat=true, then Ctrl+Shift+K). Its Credits are clawed back after the period. */
export const CHEAT = { credits: 10, until: TESTING_PERIOD_END }

/** Testing-period promo: Credits for a social media post about the platform. */
export const SOCIAL_CLAIM = {
  credits: 20,
  maxPerUser: 3,
  // Runs longer than the testing period: through 30 Dec 2026, Berlin time.
  until: Date.UTC(2026, 11, 30, 23, 0, 0),
}

/** What a social post earns at time `t`: the promo until its end, then 10 Credits for a user's first post only. */
export function socialClaimTerms(t: number): { credits: number; maxPerUser: number; promo: boolean } {
  return t < SOCIAL_CLAIM.until
    ? { credits: SOCIAL_CLAIM.credits, maxPerUser: SOCIAL_CLAIM.maxPerUser, promo: true }
    : { credits: 10, maxPerUser: 1, promo: false }
}

/** A replay the tester hasn't started is cancelled and refunded after this long. */
export const REPLAY_TTL_MS = 14 * 86_400_000

const SOCIAL_HOSTS = [
  'x.com', 'twitter.com', 'bsky.app', 'threads.net', 'threads.com', 'instagram.com', 'facebook.com', 'fb.com',
  'linkedin.com', 'reddit.com', 'tiktok.com', 'youtube.com', 'youtu.be', 'mastodon.social', 'mastodon.gamedev.place',
  'tumblr.com', 'itch.io', 'newgrounds.com', 'discord.com',
]

/** A link to a post on a known social network (or any Mastodon-style instance). Returns the normalized URL or null. */
export function normalizeSocialUrl(raw: string): string | null {
  let u: URL
  try {
    u = new URL(raw.trim())
  } catch {
    return null
  }
  if (u.protocol !== 'https:') return null
  const host = u.hostname.toLowerCase().replace(/^(www|m|mobile|old)\./, '')
  const known = SOCIAL_HOSTS.some((h) => host === h || host.endsWith(`.${h}`)) || /mastodon|social|\.masto\./.test(host)
  if (!known || u.pathname.length < 3) return null
  u.hash = ''
  for (const k of [...u.searchParams.keys()]) if (/^(utm_|ref|s$|t$|si$|igsh)/.test(k)) u.searchParams.delete(k)
  return `https://${host}${u.pathname.replace(/\/$/, '')}${u.search}`
}
