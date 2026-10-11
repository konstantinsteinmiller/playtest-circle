<script setup lang="ts">
import { onClickOutside, useDocumentVisibility, useIntervalFn } from '@vueuse/core'
import { ref, watch } from 'vue'
import type { NotificationRow } from '@shared/types'
import { api } from '@/lib/api'

const open = ref(false)
const rows = ref<NotificationRow[]>([])
const unread = ref(0)
const root = ref<HTMLElement>()
const visibility = useDocumentVisibility()

async function load() {
  try {
    const r = await api<{ rows: NotificationRow[]; unread: number }>('/me/notifications')
    rows.value = r.rows
    unread.value = r.unread
  } catch {
    /* offline or signed out — try again next tick */
  }
}

async function markRead() {
  await api('/me/notifications/read', { method: 'POST' })
  unread.value = 0
  rows.value = rows.value.map((r) => ({ ...r, readAt: r.readAt ?? Date.now() }))
}

// Poll once a minute, only while the tab is visible.
const { pause, resume } = useIntervalFn(load, 60_000, { immediateCallback: true })
watch(visibility, (v) => (v === 'visible' ? resume() : pause()))
onClickOutside(root, () => (open.value = false))
</script>

<template>
  <div ref="root" class="relative">
    <button
      type="button"
      class="relative grid size-11 place-items-center rounded-xl hover:bg-surface-2"
      :aria-label="unread ? $t('notifications.unread', unread) : $t('notifications.title')"
      :aria-expanded="open"
      @click="open = !open"
    >
      <svg viewBox="0 0 24 24" class="size-6" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
        <path d="M6 8a6 6 0 1 1 12 0c0 7 3 8 3 8H3s3-1 3-8M10 20a2 2 0 0 0 4 0" />
      </svg>
      <span
        v-if="unread"
        class="absolute -top-0.5 -right-0.5 grid min-w-5 place-items-center rounded-full bg-accent px-1 text-xs font-bold text-on-accent"
        aria-hidden="true"
        >{{ unread }}</span
      >
    </button>
    <div v-if="open" class="card absolute right-0 z-30 mt-2 w-80 max-w-[90vw] p-2 shadow-2xl">
      <div class="flex items-center justify-between px-2 py-1">
        <h2 class="h3">{{ $t('notifications.title') }}</h2>
        <button v-if="unread" type="button" class="text-sm font-semibold text-primary-ink underline" @click="markRead">
          {{ $t('notifications.markRead') }}
        </button>
      </div>
      <p v-if="!rows.length" class="px-2 py-4 text-muted">{{ $t('notifications.empty') }}</p>
      <ul class="max-h-96 overflow-auto">
        <li v-for="n in rows" :key="n.id">
          <RouterLink
            :to="String(n.payload.link ?? '/')"
            class="block rounded-lg px-2 py-2 hover:bg-surface-2"
            :class="!n.readAt && 'border-l-4 border-primary-ink'"
            @click="open = false"
          >
            <span class="block font-semibold">{{ $t(`notifications.${n.type}.title`, n.payload as Record<string, unknown>) }}</span>
            <span class="block text-sm text-muted">{{ $t(`notifications.${n.type}.body`, n.payload as Record<string, unknown>) }}</span>
          </RouterLink>
        </li>
      </ul>
    </div>
  </div>
</template>
