import { watchDebounced } from '@vueuse/core'
import { onBeforeUnmount, type Ref } from 'vue'
import { useSession } from '@/stores/session'

const PREFIX = 'ptc-draft:'
const MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000

interface Stored<T> {
  savedAt: number
  data: T
}

/**
 * Keeps an unsent form in localStorage so a hot reload, a crashed tab or an accidentally
 * closed window doesn't lose typed text. Drafts are per user and expire after 14 days.
 * Storage can be unavailable (private mode, blocked site data); then drafts silently do nothing.
 */
export function useDraft<T>(name: string, source: Ref<T> | (() => T), apply: (data: T) => void) {
  const session = useSession()
  const key = () => `${PREFIX}${session.me?.id ?? 'anon'}:${name}`
  const read = typeof source === 'function' ? source : () => source.value

  function load(): boolean {
    try {
      const raw = localStorage.getItem(key())
      if (!raw) return false
      const stored = JSON.parse(raw) as Stored<T>
      if (Date.now() - stored.savedAt > MAX_AGE_MS) {
        localStorage.removeItem(key())
        return false
      }
      apply(stored.data)
      return true
    } catch {
      return false
    }
  }

  function save() {
    try {
      localStorage.setItem(key(), JSON.stringify({ savedAt: Date.now(), data: read() } satisfies Stored<T>))
    } catch {
      /* storage full or blocked */
    }
  }

  function clear() {
    try {
      localStorage.removeItem(key())
    } catch {
      /* storage blocked */
    }
  }

  let active = true
  const stop = watchDebounced(read, () => active && save(), { deep: true, debounce: 300 })
  // Flush on tab close / HMR so the last keystrokes before leaving are kept too.
  const flush = () => active && save()
  window.addEventListener('pagehide', flush)
  onBeforeUnmount(() => {
    flush()
    stop()
    window.removeEventListener('pagehide', flush)
  })

  return {
    restore: load,
    /** Call after a successful submit; also stops further saving from this form instance. */
    discard() {
      active = false
      clear()
    },
  }
}
