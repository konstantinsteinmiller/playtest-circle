import { useI18n } from 'vue-i18n'
import { ApiError } from '@/lib/api'

/** Turns an API error code into user-facing copy, falling back to a generic message. */
export function useErrorText() {
  const { t, te } = useI18n()
  return (e: unknown, scope = 'errors') => {
    const code = e instanceof ApiError ? e.code : ''
    if (code && te(`${scope}.${code}`)) return t(`${scope}.${code}`)
    if (code && te(`errors.${code}`)) return t(`errors.${code}`)
    return t('common.unknownError')
  }
}
