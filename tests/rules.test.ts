import { describe, expect, it } from 'vitest'
import { priceAdvice, contiguousParts, normalizeSocialUrl,
  PRICE_MAX,
  PRICE_MIN,
  RECORDING,
  STORAGE_BUDGET_BYTES,
  TIDY_WINDOW_MS,
  canClaimTidyBonus,
  escrowFor,
  evaluatePayout,
  pickEvictions,
  reputationScore,
  reservationMs,
  validatePrice,
  validateSlots,
  type PayoutInput,
} from '../shared/rules'

const bytesPerMin = ((RECORDING.videoBitsPerSecond + RECORDING.audioBitsPerSecond) / 8) * 60
const MIN = 60_000

function input(over: Partial<PayoutInput> = {}): PayoutInput {
  return {
    minMinutes: 3,
    activeMs: 4 * MIN,
    recorderMs: 4 * MIN,
    recordingBytes: 4 * bytesPerMin,
    uploadComplete: true,
    requiredCount: 5,
    requiredAnswered: 5,
    ...over,
  }
}

describe('evaluatePayout', () => {
  it('pays a complete test that reached the minimum', () => {
    expect(evaluatePayout(input())).toBe('paid')
  })

  it('pays exactly at the minimum playtime', () => {
    expect(evaluatePayout(input({ activeMs: 3 * MIN, recorderMs: 3 * MIN }))).toBe('paid')
  })

  it('refuses a test that stopped before the minimum', () => {
    expect(evaluatePayout(input({ activeMs: 2.9 * MIN, recorderMs: 2.9 * MIN }))).toBe('quit_early')
  })

  it('uses the shorter of server time and recorder time', () => {
    // A tester who leaves the questionnaire open for ages must not count that as playtime…
    expect(evaluatePayout(input({ activeMs: 30 * MIN, recorderMs: 2 * MIN }))).toBe('quit_early')
    // …and a client cannot claim more recorded time than the server saw.
    expect(evaluatePayout(input({ activeMs: 2 * MIN, recorderMs: 30 * MIN }))).toBe('quit_early')
  })

  it('refuses incomplete questionnaires', () => {
    expect(evaluatePayout(input({ requiredAnswered: 4 }))).toBe('incomplete')
  })

  it('refuses when the upload never completed', () => {
    expect(evaluatePayout(input({ uploadComplete: false }))).toBe('no_recording')
    expect(evaluatePayout(input({ recordingBytes: 0 }))).toBe('no_recording')
  })

  it('refuses a recording far too small for its duration', () => {
    expect(evaluatePayout(input({ recordingBytes: 10 * 1024 }))).toBe('implausible_recording')
  })

  it('honours a shortened test minute without changing the size check', () => {
    // e2e: "3 minutes" of 1 s each; 4 s of real recording at ~8 MB/min.
    const r = evaluatePayout(input({ minuteMs: 1000, activeMs: 4000, recorderMs: 4000, recordingBytes: (bytesPerMin / 60) * 4 }))
    expect(r).toBe('paid')
  })
})

describe('economy helpers', () => {
  it('computes escrow as slots × price', () => {
    expect(escrowFor(3, 10)).toBe(30)
  })

  it('validates price and slot bounds', () => {
    expect(validatePrice(PRICE_MIN)).toBe(true)
    expect(validatePrice(PRICE_MAX)).toBe(true)
    expect(validatePrice(PRICE_MIN - 1)).toBe(false)
    expect(validatePrice(PRICE_MAX + 1)).toBe(false)
    expect(validatePrice(7.5)).toBe(false)
    expect(validateSlots(0)).toBe(false)
    expect(validateSlots(1)).toBe(true)
  })

  it('reserves at least an hour, longer for deep tests', () => {
    expect(reservationMs(3)).toBe(60 * MIN)
    expect(reservationMs(30)).toBe(90 * MIN)
  })

  it('grants the tidy bonus only within 24 h of submission', () => {
    expect(canClaimTidyBonus(0, TIDY_WINDOW_MS)).toBe(true)
    expect(canClaimTidyBonus(0, TIDY_WINDOW_MS + 1)).toBe(false)
  })

  it('smooths reputation so a single vote is not 100 %', () => {
    expect(reputationScore(0, 0)).toBe(50)
    expect(reputationScore(1, 0)).toBe(67)
    expect(reputationScore(9, 1)).toBe(83)
  })
})

describe('pickEvictions', () => {
  const GB = 1024 ** 3
  const c = (id: string, submittedAt: number, viewed: boolean, bytes = 1 * GB) => ({ id, bytes, submittedAt, viewedAt: viewed ? submittedAt + 1 : null })

  it('evicts nothing while under budget', () => {
    expect(pickEvictions([c('a', 1, true)], 1 * GB, 1 * GB, 9 * GB)).toEqual([])
  })

  it('evicts watched recordings first, oldest first', () => {
    const list = [c('new-seen', 30, true), c('old-unseen', 10, false), c('old-seen', 20, true)]
    expect(pickEvictions(list, 9 * GB, 1 * GB, 9 * GB)).toEqual(['old-seen'])
    expect(pickEvictions(list, 9 * GB, 2 * GB, 9 * GB)).toEqual(['old-seen', 'new-seen'])
  })

  it('falls back to the oldest unwatched recordings', () => {
    const list = [c('seen', 30, true), c('u2', 20, false), c('u1', 10, false)]
    expect(pickEvictions(list, 9 * GB, 3 * GB, 9 * GB)).toEqual(['seen', 'u1', 'u2'])
  })

  it('defaults to the global budget', () => {
    expect(pickEvictions([c('a', 1, false)], STORAGE_BUDGET_BYTES, 1)).toEqual(['a'])
  })
})

describe('priceAdvice', () => {
  it('scales the fair price with playtime and grades the offer', () => {
    expect(priceAdvice(10, 'quick')).toEqual({ fair: 10, fast: 15, tier: 'fair' })
    expect(priceAdvice(5, 'quick').tier).toBe('low')
    expect(priceAdvice(15, 'standard').tier).toBe('under')
    expect(priceAdvice(60, 'deep').tier).toBe('fast')
  })
})

describe('contiguousParts', () => {
  it('keeps the unbroken run from part 1', () => {
    const p = (n: number) => ({ partNumber: n, etag: `e${n}` })
    expect(contiguousParts([p(2), p(1), p(4)]).map((x) => x.partNumber)).toEqual([1, 2])
    expect(contiguousParts([p(2), p(3)])).toEqual([])
  })
})

describe('normalizeSocialUrl', () => {
  it('accepts posts on social networks and strips tracking', () => {
    expect(normalizeSocialUrl('https://www.x.com/me/status/123?s=20&t=abc')).toBe('https://x.com/me/status/123')
    expect(normalizeSocialUrl('https://bsky.app/profile/me.bsky.social/post/3k')).toBe('https://bsky.app/profile/me.bsky.social/post/3k')
    expect(normalizeSocialUrl('https://mastodon.gamedev.place/@me/1')).toBe('https://mastodon.gamedev.place/@me/1')
  })
  it('rejects other links', () => {
    expect(normalizeSocialUrl('https://example.com/post/1')).toBeNull()
    expect(normalizeSocialUrl('http://x.com/me/status/1')).toBeNull()
    expect(normalizeSocialUrl('https://x.com/')).toBeNull()
    expect(normalizeSocialUrl('not a url')).toBeNull()
  })
})
