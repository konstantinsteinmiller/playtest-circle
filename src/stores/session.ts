import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import type { Me } from '@shared/types'
import { api } from '@/lib/api'

interface Config {
  githubUrl: string
  devLogin: boolean
  googleConfigured: boolean
  storageOrigin?: string | null
}

export const useSession = defineStore('session', () => {
  const me = ref<Me | null>(null)
  const config = ref<Config>({ githubUrl: 'https://github.com/konstantinsteinmiller/playtest-circle', devLogin: false, googleConfigured: false })
  const loaded = ref(false)
  let pending: Promise<void> | null = null

  async function refresh() {
    const [m, c] = await Promise.all([api<{ user: Me | null }>('/me'), api<Config>('/config')])
    me.value = m.user
    config.value = c
    loaded.value = true
  }

  function ensureLoaded() {
    if (loaded.value) return Promise.resolve()
    pending ??= refresh().finally(() => (pending = null))
    return pending
  }

  async function logout() {
    await api('/auth/logout', { method: 'POST' })
    me.value = null
  }

  /** Testing and commenting need an account: without one, quietly start a guest account in this browser. */
  async function ensureGuest() {
    if (me.value) return
    await api('/auth/guest', { method: 'POST' })
    await refresh()
  }

  function loginUrl(returnTo = '/browse') {
    return `/api/auth/google/start?returnTo=${encodeURIComponent(returnTo)}`
  }

  return {
    me,
    config,
    loaded,
    signedIn: computed(() => !!me.value),
    /** Signed in with Google (not a guest): may post games and campaigns. */
    member: computed(() => !!me.value && !me.value.guest),
    refresh,
    ensureLoaded,
    ensureGuest,
    logout,
    loginUrl,
  }
})
