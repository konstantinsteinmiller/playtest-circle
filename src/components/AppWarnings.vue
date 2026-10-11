<script setup lang="ts">
import { computed, ref } from 'vue'
import { api } from '@/lib/api'
import { useSession } from '@/stores/session'

const session = useSession()
const busy = ref(false)
/** The oldest unacknowledged admin warning blocks the page until the user confirms they read it. */
const current = computed(() => session.me?.warnings?.[0] ?? null)

async function ack() {
  if (!current.value || !session.me) return
  busy.value = true
  try {
    await api(`/me/warnings/${current.value.id}/ack`, { method: 'POST' })
    session.me.warnings = session.me.warnings.slice(1)
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div v-if="current" class="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4">
    <section class="card max-w-lg space-y-4 border-warn-ink p-6" role="alertdialog" aria-modal="true" aria-labelledby="warning-title" data-testid="warning-dialog">
      <h2 id="warning-title" class="h2 text-warn-ink">⚠ {{ $t('warning.title') }}</h2>
      <p class="text-muted">{{ $t('warning.lead') }}</p>
      <p class="whitespace-pre-line rounded-xl border-2 border-line p-4 font-semibold">{{ current.reason }}</p>
      <button type="button" class="btn btn-primary w-full" :disabled="busy" data-testid="warning-ack" @click="ack">{{ $t('warning.ack') }}</button>
    </section>
  </div>
</template>
