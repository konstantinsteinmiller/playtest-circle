<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { api } from '@/lib/api'

const stats = ref<{ active: number; online: number } | null>(null)
onMounted(async () => {
  stats.value = await api<{ active: number; online: number }>('/stats').catch(() => null)
})
</script>

<template>
  <p v-if="stats" class="flex flex-wrap items-center gap-2 font-semibold" data-testid="user-counter">
    <span class="chip">👥 {{ $t('stats.active', stats.active) }}</span>
    <span class="chip border-primary-ink text-primary-ink">
      <span class="inline-block size-2 rounded-full bg-primary" aria-hidden="true" /> {{ $t('stats.online', stats.online) }}
    </span>
  </p>
</template>
