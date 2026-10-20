<script setup lang="ts">
import GoogleIcon from '@/components/GoogleIcon.vue'
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'
import { PRICE_MIN, RECORDING_QUOTA_BYTES } from '@shared/rules'
import type { CampaignCard, Game } from '@shared/types'
import { api } from '@/lib/api'
import { formatBytes, formatDuration } from '@/lib/format'
import { useSession } from '@/stores/session'

type MyCampaign = CampaignCard & { slotsPaid: number; escrow: number; submitted: number }

const session = useSession()
const games = ref<Game[]>([])
const campaigns = ref<MyCampaign[]>([])
interface MyTest {
  id: string
  status: string
  payout_reason: string | null
  submitted_at: number | null
  created_at: number
  active_ms: number | null
  credits_awarded: number
  title: string
  campaign_id: string
  build_label: string
  has_recording: number
}

const { t, d } = useI18n()
const route = useRoute()
const router = useRouter()
const tests = ref<MyTest[]>([])
const loading = ref(true)
const tab = computed<'studio' | 'tested'>({
  get: () => (route.query.tab === 'tested' ? 'tested' : 'studio'),
  set: (v) => router.replace({ query: v === 'tested' ? { tab: 'tested' } : {} }),
})

onMounted(async () => {
  const [g, c, p] = await Promise.all([
    api<{ games: Game[] }>('/games'),
    api<{ campaigns: MyCampaign[] }>('/campaigns/mine'),
    api<{ playtests: MyTest[] }>('/playtests/mine'),
    session.refresh(),
  ])
  games.value = g.games
  campaigns.value = c.campaigns
  tests.value = p.playtests
  loading.value = false
})

function testStatus(x: MyTest) {
  if (x.status === 'expired') return t('results.status.expired')
  if (!x.submitted_at) return t('results.status.in_progress')
  return t(`results.status.${x.payout_reason ?? 'paid'}`)
}

const used = computed(() => session.me?.recordingBytes ?? 0)
const usedPct = computed(() => Math.min(100, (used.value / RECORDING_QUOTA_BYTES) * 100))
const over = computed(() => used.value > RECORDING_QUOTA_BYTES)
const statusClass: Record<string, string> = {
  live: 'border-primary-ink text-primary-ink',
  paused: 'border-warn-ink text-warn-ink',
  completed: 'border-info-ink text-info-ink',
  cancelled: 'text-muted',
  draft: 'text-muted',
}
</script>

<template>
  <div class="space-y-10">
    <header class="flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 class="h1">{{ $t('studio.title') }}</h1>
        <p class="mt-1 text-muted">{{ $t('studio.lead') }}</p>
      </div>
      <div class="flex flex-wrap gap-2">
        <RouterLink to="/studio/games/new" class="btn btn-secondary">＋ {{ $t('studio.newGame') }}</RouterLink>
        <RouterLink to="/studio/campaigns/new" class="btn btn-primary">🚀 {{ $t('studio.newCampaign') }}</RouterLink>
      </div>
    </header>

    <div role="tablist" :aria-label="$t('studio.tabsLabel')" class="flex flex-wrap gap-2">
      <button
        v-for="k in ['studio', 'tested'] as const"
        :key="k"
        type="button"
        role="tab"
        :aria-selected="tab === k"
        class="btn"
        :class="tab === k ? 'btn-primary' : 'btn-secondary'"
        :data-testid="`studio-tab-${k}`"
        @click="tab = k"
      >
        {{ k === 'studio' ? $t('studio.tabStudio') : $t('studio.tabTested', { n: tests.length }) }}
      </button>
    </div>

    <section v-if="tab === 'tested'" class="space-y-4" data-testid="tested-list">
      <p class="text-muted">{{ $t('studio.testedLead') }}</p>
      <p v-if="!loading && !tests.length" class="card p-6 text-muted">{{ $t('studio.noTested') }}</p>
      <ul v-else class="space-y-3">
        <li v-for="x in tests" :key="x.id" class="card flex flex-wrap items-center gap-4 p-4" data-testid="tested-row">
          <div class="min-w-48 flex-1">
            <p class="h3">{{ x.title }} <span class="text-base font-medium text-muted">· {{ x.build_label }}</span></p>
            <p class="text-sm text-muted">
              {{ d(new Date(x.created_at), { dateStyle: 'medium' } as never) }} · {{ testStatus(x) }}<template v-if="x.active_ms"> · {{ formatDuration(x.active_ms) }}</template>
              <template v-if="x.submitted_at && !x.has_recording"> · {{ $t('studio.recordingGone') }}</template>
            </p>
          </div>
          <span v-if="x.credits_awarded" class="font-display text-xl font-bold text-primary-ink">+{{ x.credits_awarded }}</span>
          <RouterLink v-if="['reserved', 'recording'].includes(x.status)" :to="`/play/${x.id}`" class="btn btn-primary">{{ $t('campaign.continuePlaytest') }}</RouterLink>
          <RouterLink v-else-if="x.submitted_at" :to="`/studio/playtests/${x.id}`" class="btn btn-primary" data-testid="watch-own">
            {{ x.has_recording ? '▶ ' + $t('studio.watchMine') : $t('studio.viewMine') }}
          </RouterLink>
          <RouterLink v-else :to="`/c/${x.campaign_id}`" class="btn btn-secondary">{{ $t('studio.openCampaign') }}</RouterLink>
        </li>
      </ul>
    </section>

    <template v-else>
    <section v-if="session.me?.guest" class="card border-warn-ink p-5" role="status" data-testid="studio-guest-warning">
      <h2 class="h3 text-warn-ink">{{ $t('studio.guestTitle') }}</h2>
      <p class="mt-1">{{ $t('studio.guestBody') }}</p>
      <a :href="session.loginUrl('/studio')" class="btn btn-primary mt-3"><GoogleIcon />{{ $t('studio.guestKeep') }}</a>
    </section>

    <section v-if="session.me && session.me.credits < PRICE_MIN" class="card border-warn-ink p-5">
      <h2 class="h3 text-warn-ink">{{ $t('studio.needCreditsTitle') }}</h2>
      <p class="mt-1">{{ $t('studio.needCreditsBody', { n: session.me.credits }) }}</p>
      <RouterLink to="/browse" class="btn btn-secondary mt-3">{{ $t('nav.browse') }}</RouterLink>
    </section>

    <section class="card space-y-3 p-5">
      <h2 class="h3">{{ $t('studio.storageTitle') }}</h2>
      <div
        class="h-3 overflow-hidden rounded-full bg-surface-2"
        role="meter"
        :aria-valuenow="Math.round(usedPct)"
        aria-valuemin="0"
        aria-valuemax="100"
        :aria-label="$t('studio.storageTitle')"
      >
        <div class="h-full" :class="over ? 'bg-danger' : 'bg-primary'" :style="{ width: `${usedPct}%` }" />
      </div>
      <p :class="over ? 'font-semibold text-danger-ink' : 'text-muted'">
        {{ over ? $t('studio.storageOver') : $t('studio.storageBody', { used: formatBytes(used), quota: formatBytes(RECORDING_QUOTA_BYTES) }) }}
      </p>
    </section>

    <section class="space-y-4">
      <h2 class="h2">{{ $t('studio.campaigns') }}</h2>
      <p v-if="!loading && !campaigns.length" class="card p-6 text-muted">{{ $t('studio.noCampaigns') }}</p>
      <ul class="space-y-3">
        <li v-for="c in campaigns" :key="c.id" class="card flex flex-wrap items-center gap-4 p-4">
          <img v-if="c.game.coverUrl" :src="c.game.coverUrl" alt="" class="aspect-video w-32 rounded-lg object-cover" />
          <div class="min-w-48 flex-1">
            <p class="h3">{{ c.game.title }} <span class="text-base font-medium text-muted">· {{ c.buildLabel }}</span></p>
            <p v-if="c.replayFor" class="text-sm font-semibold text-accent-ink">↻ {{ $t('replay.for', { name: c.replayFor.name }) }}</p>
            <p class="text-sm text-muted">
              {{ $t('studio.progress', { paid: c.slotsPaid, total: c.slotsTotal }) }} · {{ $t('studio.escrow', { n: c.escrow }) }} ·
              {{ $t(`presets.playtime.${c.playtimePreset}`) }}
            </p>
          </div>
          <span class="chip font-semibold" :class="statusClass[c.status]">{{ $t(`studio.status.${c.status}`) }}</span>
          <RouterLink :to="`/studio/campaigns/${c.id}`" class="btn btn-primary">{{ $t('studio.results') }} ({{ c.submitted }})</RouterLink>
        </li>
      </ul>
    </section>

    <section class="space-y-4">
      <h2 class="h2">{{ $t('studio.games') }}</h2>
      <p v-if="!loading && !games.length" class="card p-6 text-muted">{{ $t('studio.noGames') }}</p>
      <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <article v-for="g in games" :key="g.id" class="card overflow-hidden">
          <img v-if="g.coverUrl" :src="g.coverUrl" :alt="$t('campaign.coverAlt', { title: g.title })" class="aspect-video w-full object-cover" />
          <div class="space-y-3 p-4">
            <h3 class="h3">{{ g.title }}</h3>
            <p class="line-clamp-2 text-muted">{{ g.pitch }}</p>
            <div class="flex flex-wrap gap-2">
              <RouterLink :to="`/studio/campaigns/new?game=${g.id}`" class="btn btn-primary">{{ $t('studio.launchFor') }}</RouterLink>
              <RouterLink :to="`/studio/games/${g.id}/edit`" class="btn btn-secondary">{{ $t('studio.editGame') }}</RouterLink>
            </div>
          </div>
        </article>
      </div>
    </section>
    </template>
  </div>
</template>
