<script setup lang="ts">
import { useDebounceFn } from '@vueuse/core'
import { onMounted, reactive, ref, watch } from 'vue'
import { PLAYTIME_PRESETS, PRICE_PRESETS } from '@shared/rules'
import type { CampaignCard as Card, GameHost } from '@shared/types'
import CampaignCard from '@/components/CampaignCard.vue'
import { api } from '@/lib/api'

const LAYOUT_KEY = 'ptc-browse-layout'
function readLayout(): 'grid' | 'list' {
  try {
    return localStorage.getItem(LAYOUT_KEY) === 'list' ? 'list' : 'grid'
  } catch {
    return 'grid'
  }
}

const layout = ref<'grid' | 'list'>(readLayout())
watch(layout, (v) => {
  try {
    localStorage.setItem(LAYOUT_KEY, v)
  } catch {
    /* storage blocked */
  }
})

const hosts: GameHost[] = ['itch', 'steam', 'wavedash', 'crazygames', 'newgrounds', 'own', 'other']
const filters = reactive({ q: '', sort: 'pay', preset: '', host: '', tag: '', minPrice: '' })
const campaigns = ref<Card[]>([])
const invites = ref<Card[]>([])
const tags = ref<string[]>([])
const loading = ref(true)
const filtersOpen = ref(false)

async function load() {
  loading.value = true
  const qs = new URLSearchParams(Object.entries(filters).filter(([, v]) => v !== '') as [string, string][])
  try {
    const r = await api<{ campaigns: Card[]; tags: string[]; invites: Card[] }>(`/campaigns?${qs}`)
    campaigns.value = r.campaigns
    invites.value = r.invites
    if (!filters.tag) tags.value = r.tags
  } finally {
    loading.value = false
  }
}
const debounced = useDebounceFn(load, 250)
watch(filters, debounced)
onMounted(load)
</script>

<template>
  <div class="space-y-6">
    <header class="flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 class="h1">{{ $t('browse.title') }}</h1>
        <p class="mt-1 text-muted">{{ $t('browse.lead') }}</p>
        <RouterLink to="/games" class="mt-2 inline-block font-semibold text-primary-ink underline" data-testid="all-games-link">{{ $t('browse.allGames') }}</RouterLink>
      </div>
      <div role="radiogroup" :aria-label="$t('browse.layout')" class="inline-flex rounded-xl border-2 border-line p-0.5">
        <button
          v-for="l in ['grid', 'list'] as const"
          :key="l"
          type="button"
          role="radio"
          :aria-checked="layout === l"
          class="flex min-h-10 items-center gap-2 rounded-lg px-3 font-semibold"
          :class="layout === l ? 'bg-primary text-on-primary' : 'hover:bg-surface-2'"
          @click="layout = l"
        >
          <svg viewBox="0 0 24 24" class="size-5" fill="currentColor" aria-hidden="true">
            <path v-if="l === 'grid'" d="M3 3h8v8H3zm10 0h8v8h-8zM3 13h8v8H3zm10 0h8v8h-8z" />
            <path v-else d="M3 4h18v4H3zm0 6h18v4H3zm0 6h18v4H3z" />
          </svg>
          {{ $t(`browse.${l}`) }}
        </button>
      </div>
    </header>

    <section v-if="invites.length" class="space-y-3" data-testid="replay-invites">
      <h2 class="h2">↻ {{ $t('browse.invitesTitle') }}</h2>
      <p class="text-muted">{{ $t('browse.invitesLead') }}</p>
      <div :class="layout === 'grid' ? 'grid gap-5 sm:grid-cols-2 xl:grid-cols-3' : 'flex flex-col gap-4'">
        <CampaignCard v-for="c in invites" :key="c.id" :campaign="c" :layout="layout" />
      </div>
    </section>

    <div class="card grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-6">
      <label class="lg:col-span-2">
        <span class="field-label text-sm">{{ $t('browse.search') }}</span>
        <input v-model="filters.q" type="search" class="input" :placeholder="$t('browse.searchPlaceholder')" />
      </label>
      <button type="button" class="btn btn-secondary sm:hidden" :aria-expanded="filtersOpen" @click="filtersOpen = !filtersOpen">
        ⚙ {{ $t('browse.filters') }}
      </button>
      <label :class="[filtersOpen ? '' : 'hidden sm:block', '']">
        <span class="field-label text-sm">{{ $t('browse.sort') }}</span>
        <select v-model="filters.sort" class="input">
          <option value="pay">{{ $t('browse.sortPay') }}</option>
          <option value="new">{{ $t('browse.sortNew') }}</option>
          <option value="slots">{{ $t('browse.sortSlots') }}</option>
        </select>
      </label>
      <label :class="[filtersOpen ? '' : 'hidden sm:block', '']">
        <span class="field-label text-sm">{{ $t('browse.playtime') }}</span>
        <select v-model="filters.preset" class="input">
          <option value="">{{ $t('browse.anyPlaytime') }}</option>
          <option v-for="p in PLAYTIME_PRESETS" :key="p.id" :value="p.id">{{ $t(`presets.playtime.${p.id}`) }}</option>
        </select>
      </label>
      <label :class="[filtersOpen ? '' : 'hidden sm:block', '']">
        <span class="field-label text-sm">{{ $t('browse.host') }}</span>
        <select v-model="filters.host" class="input">
          <option value="">{{ $t('browse.anyHost') }}</option>
          <option v-for="h in hosts" :key="h" :value="h">{{ $t(`hosts.${h}`) }}</option>
        </select>
      </label>
      <label :class="[filtersOpen ? '' : 'hidden sm:block', '']">
        <span class="field-label text-sm">{{ $t('browse.minPay') }}</span>
        <select v-model="filters.minPrice" class="input">
          <option value="">{{ $t('browse.anyPay') }}</option>
          <option v-for="p in PRICE_PRESETS" :key="p.id" :value="String(p.price)">≥ {{ $t('common.credits', p.price) }}</option>
        </select>
      </label>
      <label v-if="tags.length" :class="[filtersOpen ? '' : 'hidden sm:block', 'sm:col-span-2 lg:col-span-6']">
        <span class="field-label text-sm">{{ $t('browse.tag') }}</span>
        <select v-model="filters.tag" class="input">
          <option value="">{{ $t('browse.anyTag') }}</option>
          <option v-for="t in tags" :key="t" :value="t">#{{ t }}</option>
        </select>
      </label>
    </div>

    <p class="sr-only" aria-live="polite">{{ loading ? $t('common.loading') : $t('browse.count', campaigns.length) }}</p>

    <div v-if="!loading && !campaigns.length" class="card flex flex-col items-center gap-4 p-10 text-center">
      <p class="text-lg">{{ $t('browse.empty') }}</p>
      <RouterLink to="/studio/campaigns/new" class="btn btn-primary">{{ $t('browse.emptyCta') }}</RouterLink>
    </div>
    <div v-else :class="layout === 'grid' ? 'grid gap-5 sm:grid-cols-2 xl:grid-cols-3' : 'flex flex-col gap-4'" :aria-busy="loading">
      <CampaignCard v-for="c in campaigns" :key="c.id" :campaign="c" :layout="layout" />
    </div>
  </div>
</template>
