<script setup lang="ts">
import { useDebounceFn } from '@vueuse/core'
import { onMounted, ref, watch } from 'vue'
import type { GameCard } from '@shared/types'
import { api } from '@/lib/api'

const q = ref('')
const games = ref<GameCard[]>([])
const loading = ref(true)

async function load() {
  loading.value = true
  try {
    games.value = (await api<{ games: GameCard[] }>(`/games/catalog?${new URLSearchParams(q.value ? { q: q.value } : {})}`)).games
  } finally {
    loading.value = false
  }
}
watch(q, useDebounceFn(load, 250))
onMounted(load)
</script>

<template>
  <div class="space-y-6">
    <header class="flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 class="h1">{{ $t('games.title') }}</h1>
        <p class="mt-1 text-muted">{{ $t('games.lead') }}</p>
      </div>
      <RouterLink to="/browse" class="btn btn-secondary">◎ {{ $t('games.paidOnly') }}</RouterLink>
    </header>

    <label class="card block p-4">
      <span class="field-label text-sm">{{ $t('browse.search') }}</span>
      <input v-model="q" type="search" class="input" :placeholder="$t('browse.searchPlaceholder')" data-testid="games-search" />
    </label>

    <p class="sr-only" aria-live="polite">{{ loading ? $t('common.loading') : $t('games.count', games.length) }}</p>
    <p v-if="!loading && !games.length" class="card p-10 text-center text-lg">{{ $t('games.empty') }}</p>
    <div v-else class="grid gap-5 sm:grid-cols-2 xl:grid-cols-3" :aria-busy="loading">
      <article v-for="g in games" :key="g.id" class="card relative flex flex-col overflow-hidden transition hover:-translate-y-0.5 hover:border-primary-ink focus-within:border-primary-ink">
        <div class="aspect-video overflow-hidden bg-surface-2">
          <img v-if="g.coverUrl" :src="g.coverUrl" :alt="$t('campaign.coverAlt', { title: g.title })" class="size-full object-cover" loading="lazy" />
          <div v-else class="grid size-full place-items-center font-display text-4xl font-bold text-muted" aria-hidden="true">{{ g.title.slice(0, 2).toUpperCase() }}</div>
        </div>
        <div class="flex flex-1 flex-col gap-2 p-5">
          <h2 class="h3">
            <RouterLink :to="`/g/${g.id}`" class="after:absolute after:inset-0">{{ g.title }}</RouterLink>
          </h2>
          <p class="text-sm text-muted">{{ $t('browse.by', { name: g.owner.name }) }} · {{ $t(`hosts.${g.host}`) }}</p>
          <p class="flex-1">{{ g.pitch }}</p>
          <div class="flex flex-wrap items-center gap-2 text-sm font-semibold">
            <span v-if="g.openPlaytests" class="pill-credit">◎ {{ $t('games.paidPlaytest', { n: g.topPrice }) }}</span>
            <span v-else class="chip">{{ $t('games.freePlay') }}</span>
            <span class="chip">💬 {{ g.comments }}</span>
          </div>
        </div>
      </article>
    </div>
  </div>
</template>
