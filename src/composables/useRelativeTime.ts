import { useI18n } from 'vue-i18n'

/** "in 5 hours" style text for a future timestamp. */
export function useRelativeTime() {
  const { t } = useI18n()
  return (ts: number) => {
    const ms = Math.max(0, ts - Date.now())
    const min = Math.round(ms / 60_000)
    if (min < 60) return t('time.inMinutes', min)
    const h = Math.round(min / 60)
    if (h < 48) return t('time.inHours', h)
    return t('time.inDays', Math.round(h / 24))
  }
}
