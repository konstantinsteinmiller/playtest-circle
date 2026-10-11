<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { CHEAT } from '@shared/rules'
import { api } from '@/lib/api'
import { useSession } from '@/stores/session'

const session = useSession()
const { t, d } = useI18n()
const toasts = ref<{ id: number; text: string }[]>([])
let seq = 0

function show(text: string, ms = 6000) {
  const id = ++seq
  toasts.value.push({ id, text })
  setTimeout(() => dismiss(id), ms)
}
function dismiss(id: number) {
  toasts.value = toasts.value.filter((x) => x.id !== id)
}

// Cheat removal notice: shown once, then acknowledged on the server.
watch(
  () => session.me?.cheatRemoved,
  async (n) => {
    if (!n) return
    show(t('cheat.removed', { n }), 12000)
    await api('/me', { method: 'PATCH', json: { ackCheatNotice: true } }).catch(() => {})
    if (session.me) session.me.cheatRemoved = 0
  },
  { immediate: true },
)

// Testing-period cheat: open any page with ?cheat=true once, then press Ctrl+Shift+K.
const CHEAT_KEY = 'ptc-cheat'
function cheatEnabled() {
  try {
    if (new URLSearchParams(location.search).get('cheat') === 'true') sessionStorage.setItem(CHEAT_KEY, '1')
    return sessionStorage.getItem(CHEAT_KEY) === '1'
  } catch {
    return new URLSearchParams(location.search).get('cheat') === 'true'
  }
}
let busy = false
async function onKey(e: KeyboardEvent) {
  if (!(e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'k') || !session.me || !cheatEnabled()) return
  e.preventDefault()
  if (Date.now() >= CHEAT.until) return show(t('cheat.ended'))
  if (busy) return
  busy = true
  try {
    const r = await api<{ credits: number }>('/me/cheat', { method: 'POST' })
    await session.refresh()
    show(t('cheat.granted', { n: r.credits, date: d(new Date(CHEAT.until - 1), { dateStyle: 'medium' } as never) }))
  } catch {
    show(t('cheat.ended'))
  } finally {
    busy = false
  }
}
onMounted(() => {
  cheatEnabled()
  window.addEventListener('keydown', onKey)
})
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
</script>

<template>
  <div class="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex flex-col items-center gap-2 px-4" aria-live="polite">
    <div
      v-for="x in toasts"
      :key="x.id"
      class="pointer-events-auto flex max-w-lg items-start gap-3 rounded-xl border-2 border-primary bg-surface p-4 font-semibold shadow-lg"
      role="status"
      data-testid="toast"
    >
      <span class="flex-1">{{ x.text }}</span>
      <button type="button" class="btn btn-ghost min-h-8 px-2 py-0" :aria-label="$t('cheat.dismiss')" @click="dismiss(x.id)">✕</button>
    </div>
  </div>
</template>
