import { useI18n } from 'vue-i18n'
import type { CampaignQuestion } from '@shared/questions'

export function useQuestionText() {
  const { t, te } = useI18n()
  return {
    text: (q: Pick<CampaignQuestion, 'id' | 'text'>) => q.text ?? t(`catalog.${q.id}.text`),
    hint: (q: Pick<CampaignQuestion, 'id' | 'text'>) => (q.text ? '' : te(`catalog.${q.id}.hint`) ? t(`catalog.${q.id}.hint`) : ''),
  }
}
