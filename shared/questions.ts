// Best-practice question catalog. Wording lives in src/i18n/en.json under
// `catalog.<id>` so it can be translated; this file only holds structure.

export type AnswerType = 'scale5' | 'feeling5' | 'yesno' | 'text'

export const CATEGORIES = [
  'controls',
  'onboarding',
  'progression',
  'difficulty',
  'bosses',
  'pacing',
  'stuck',
  'ui',
  'audio',
  'visuals',
  'performance',
  'overall',
] as const
export type Category = (typeof CATEGORIES)[number]

export interface CatalogQuestion {
  id: string
  category: Category
  type: AnswerType
  allowNa: boolean
}

export const CATALOG: CatalogQuestion[] = [
  { id: 'controls_feel', category: 'controls', type: 'scale5', allowNa: false },
  { id: 'controls_responsive', category: 'controls', type: 'scale5', allowNa: false },
  { id: 'controls_intuitive', category: 'controls', type: 'feeling5', allowNa: false },
  { id: 'onboarding_goal_clear', category: 'onboarding', type: 'feeling5', allowNa: false },
  { id: 'onboarding_first3', category: 'onboarding', type: 'scale5', allowNa: false },
  { id: 'onboarding_tutorial', category: 'onboarding', type: 'scale5', allowNa: true },
  { id: 'progression_short', category: 'progression', type: 'scale5', allowNa: true },
  { id: 'progression_long', category: 'progression', type: 'scale5', allowNa: true },
  { id: 'progression_rewards', category: 'progression', type: 'feeling5', allowNa: true },
  { id: 'difficulty_curve', category: 'difficulty', type: 'scale5', allowNa: false },
  { id: 'difficulty_missing_challenge', category: 'difficulty', type: 'feeling5', allowNa: false },
  { id: 'difficulty_unfair', category: 'difficulty', type: 'feeling5', allowNa: false },
  { id: 'bosses_too_hard', category: 'bosses', type: 'feeling5', allowNa: true },
  { id: 'bosses_too_easy', category: 'bosses', type: 'feeling5', allowNa: true },
  { id: 'bosses_readable', category: 'bosses', type: 'scale5', allowNa: true },
  { id: 'pacing_boring', category: 'pacing', type: 'text', allowNa: false },
  { id: 'pacing_one_more', category: 'pacing', type: 'feeling5', allowNa: false },
  { id: 'stuck_where', category: 'stuck', type: 'text', allowNa: false },
  { id: 'stuck_confusing', category: 'stuck', type: 'feeling5', allowNa: false },
  { id: 'ui_readable', category: 'ui', type: 'scale5', allowNa: false },
  { id: 'ui_feedback', category: 'ui', type: 'scale5', allowNa: false },
  { id: 'audio_quality', category: 'audio', type: 'scale5', allowNa: true },
  { id: 'audio_feedback', category: 'audio', type: 'feeling5', allowNa: true },
  { id: 'visuals_style', category: 'visuals', type: 'scale5', allowNa: false },
  { id: 'visuals_clarity', category: 'visuals', type: 'scale5', allowNa: false },
  { id: 'performance_smooth', category: 'performance', type: 'scale5', allowNa: false },
  { id: 'performance_bugs', category: 'performance', type: 'text', allowNa: false },
  { id: 'overall_fun', category: 'overall', type: 'scale5', allowNa: false },
  { id: 'overall_return', category: 'overall', type: 'feeling5', allowNa: false },
]

/** Appended to every campaign. `quit_reason` is only required when the tester stopped early. */
export const SYSTEM_QUESTIONS: CatalogQuestion[] = [
  { id: 'sys_overall', category: 'overall', type: 'scale5', allowNa: false },
  { id: 'sys_stuck', category: 'stuck', type: 'text', allowNa: false },
  { id: 'sys_quit_reason', category: 'pacing', type: 'text', allowNa: false },
]

/** A question as frozen into a campaign at publish time. */
export interface CampaignQuestion {
  id: string
  type: AnswerType
  allowNa: boolean
  required: boolean
  /** Only custom questions carry their own wording; catalog questions are looked up by id. */
  text?: string
  source: 'catalog' | 'custom' | 'system'
}

export interface AnswerInput {
  questionId: string
  value: number | null
  na: boolean
  text: string
}

export function catalogById(id: string): CatalogQuestion | undefined {
  return CATALOG.find((q) => q.id === id) ?? SYSTEM_QUESTIONS.find((q) => q.id === id)
}

export function maxValue(type: AnswerType): number {
  if (type === 'yesno') return 1
  if (type === 'text') return 0
  return 5
}

export interface CustomQuestionInput {
  text: string
  type: AnswerType
  allowNa: boolean
}

/** Builds the immutable question snapshot. Throws on invalid input. */
export function buildSnapshot(catalogIds: string[], custom: CustomQuestionInput[]): CampaignQuestion[] {
  const unique = [...new Set(catalogIds)]
  if (unique.length + custom.length === 0) throw new Error('questions_required')
  if (custom.length > 5) throw new Error('too_many_custom')
  const out: CampaignQuestion[] = []
  for (const id of unique) {
    const q = CATALOG.find((c) => c.id === id)
    if (!q) throw new Error(`unknown_question:${id}`)
    out.push({ id: q.id, type: q.type, allowNa: q.allowNa, required: true, source: 'catalog' })
  }
  custom.forEach((c, i) => {
    const text = c.text.trim()
    if (text.length < 3 || text.length > 300) throw new Error('custom_text_length')
    if (!['scale5', 'feeling5', 'yesno', 'text'].includes(c.type)) throw new Error('custom_type')
    out.push({ id: `custom_${i + 1}`, type: c.type, allowNa: !!c.allowNa, required: true, text, source: 'custom' })
  })
  for (const s of SYSTEM_QUESTIONS) {
    out.push({
      id: s.id,
      type: s.type,
      allowNa: s.allowNa,
      // sys_quit_reason's requirement depends on playtime, decided at submit.
      required: s.id === 'sys_overall',
      source: 'system',
    })
  }
  return out
}

export function isAnswered(q: CampaignQuestion, a: AnswerInput | undefined): boolean {
  if (!a) return false
  if (q.type === 'text') return a.text.trim().length >= 3
  if (a.na) return q.allowNa
  return a.value !== null && Number.isInteger(a.value) && a.value >= (q.type === 'yesno' ? 0 : 1) && a.value <= maxValue(q.type)
}

/** Counts required questions and how many were answered. */
export function countAnswered(questions: CampaignQuestion[], answers: AnswerInput[], quitEarly: boolean) {
  const byId = new Map(answers.map((a) => [a.questionId, a]))
  let required = 0
  let answered = 0
  let requiredAnswered = 0
  for (const q of questions) {
    const isReq = q.required || (q.id === 'sys_quit_reason' && quitEarly)
    const ok = isAnswered(q, byId.get(q.id))
    if (ok) answered++
    if (isReq) {
      required++
      if (ok) requiredAnswered++
    }
  }
  return { required, answered, requiredAnswered, total: questions.length }
}
