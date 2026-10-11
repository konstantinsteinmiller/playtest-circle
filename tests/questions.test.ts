import { describe, expect, it } from 'vitest'
import en from '../src/i18n/en.json'
import { CATALOG, CATEGORIES, SYSTEM_QUESTIONS, buildSnapshot, countAnswered, isAnswered, type AnswerInput } from '../shared/questions'

const a = (questionId: string, value: number | null, text = '', na = false): AnswerInput => ({ questionId, value, text, na })

describe('question catalog', () => {
  it('has unique ids', () => {
    const ids = [...CATALOG, ...SYSTEM_QUESTIONS].map((q) => q.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('has English wording and a hint for every question and category', () => {
    const catalog = en.catalog as unknown as Record<string, { text?: string; hint?: string } | Record<string, string>>
    for (const q of [...CATALOG, ...SYSTEM_QUESTIONS]) {
      const entry = catalog[q.id] as { text?: string; hint?: string }
      expect(entry?.text, q.id).toBeTruthy()
      expect(entry?.hint, q.id).toBeTruthy()
    }
    for (const c of CATEGORIES) expect((en.catalog.categories as Record<string, string>)[c], c).toBeTruthy()
  })
})

describe('buildSnapshot', () => {
  it('freezes catalog + custom questions and appends the system questions', () => {
    const s = buildSnapshot(['controls_feel', 'controls_feel', 'bosses_too_hard'], [{ text: 'Is the jump too floaty?', type: 'yesno', allowNa: false }])
    expect(s.map((q) => q.id)).toEqual(['controls_feel', 'bosses_too_hard', 'custom_1', 'sys_overall', 'sys_stuck', 'sys_quit_reason'])
    expect(s.find((q) => q.id === 'custom_1')?.text).toBe('Is the jump too floaty?')
    expect(s.find((q) => q.id === 'sys_stuck')?.required).toBe(false)
  })

  it('rejects empty, unknown and oversized input', () => {
    expect(() => buildSnapshot([], [])).toThrow('questions_required')
    expect(() => buildSnapshot(['nope'], [])).toThrow('unknown_question')
    expect(() => buildSnapshot([], Array.from({ length: 6 }, () => ({ text: 'abc?', type: 'scale5' as const, allowNa: false })))).toThrow('too_many_custom')
    expect(() => buildSnapshot([], [{ text: 'x', type: 'scale5', allowNa: false }])).toThrow('custom_text_length')
  })
})

describe('answers', () => {
  const qs = buildSnapshot(['controls_feel', 'bosses_too_hard', 'pacing_boring'], [])

  it('validates per answer type', () => {
    const scale = qs.find((q) => q.id === 'controls_feel')!
    const naOk = qs.find((q) => q.id === 'bosses_too_hard')!
    const text = qs.find((q) => q.id === 'pacing_boring')!
    expect(isAnswered(scale, a('controls_feel', 3))).toBe(true)
    expect(isAnswered(scale, a('controls_feel', 6))).toBe(false)
    expect(isAnswered(scale, a('controls_feel', null, '', true))).toBe(false)
    expect(isAnswered(naOk, a('bosses_too_hard', null, '', true))).toBe(true)
    expect(isAnswered(text, a('pacing_boring', null, 'ok'))).toBe(false)
    expect(isAnswered(text, a('pacing_boring', null, 'Level 3, the long corridor.'))).toBe(true)
  })

  it('only requires the quit reason when the tester stopped early', () => {
    const full = [a('controls_feel', 4), a('bosses_too_hard', null, '', true), a('pacing_boring', null, 'Never got boring'), a('sys_overall', 4)]
    expect(countAnswered(qs, full, false)).toMatchObject({ required: 4, requiredAnswered: 4 })
    expect(countAnswered(qs, full, true)).toMatchObject({ required: 5, requiredAnswered: 4 })
    expect(countAnswered(qs, [...full, a('sys_quit_reason', null, 'Had to leave')], true)).toMatchObject({ required: 5, requiredAnswered: 5 })
  })
})
