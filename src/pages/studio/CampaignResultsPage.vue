<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute } from 'vue-router'
import { reputationScore } from '@shared/rules'
import type { CampaignDetail, PlaytestRow } from '@shared/types'
import { useErrorText } from '@/composables/useErrorText'
import { useQuestionText } from '@/composables/useQuestionText'
import { useRelativeTime } from '@/composables/useRelativeTime'
import { api } from '@/lib/api'
import { formatDuration } from '@/lib/format'
import { useSession } from '@/stores/session'

interface Aggregate {
  questionId: string
  count: number
  na: number
  average: number | null
  distribution: number[]
  texts: { playtestId: string; tester: string; text: string }[]
}

const route = useRoute()
const { t } = useI18n()
const session = useSession()
const errorText = useErrorText()
const qt = useQuestionText()
const rel = useRelativeTime()
const id = String(route.params.id)
const campaign = ref<CampaignDetail | null>(null)
const rows = ref<PlaytestRow[]>([])
const aggregates = ref<Aggregate[]>([])
const slotsPaid = ref(0)
const error = ref('')
const published = route.query.published === '1'

async function load() {
  try {
    const r = await api<{ campaign: CampaignDetail; playtests: PlaytestRow[]; aggregates: Aggregate[]; slotsPaid: number }>(`/campaigns/${id}/results`)
    campaign.value = r.campaign
    rows.value = r.playtests
    aggregates.value = r.aggregates
    slotsPaid.value = r.slotsPaid
  } catch (e) {
    error.value = errorText(e)
  }
}
onMounted(load)

function statusKey(p: PlaytestRow) {
  if (p.status === 'expired') return 'expired'
  if (!p.submittedAt) return 'in_progress'
  return p.payoutReason ?? 'paid'
}
const statusClass: Record<string, string> = {
  paid: 'border-primary-ink text-primary-ink',
  in_progress: 'border-info-ink text-info-ink',
  quit_early: 'border-warn-ink text-warn-ink',
  incomplete: 'border-warn-ink text-warn-ink',
  expired: 'text-muted',
}
const statusIcon: Record<string, string> = { paid: '✓', in_progress: '●', quit_early: '⏹', incomplete: '◐', expired: '✕' }

const questionById = computed(() => new Map((campaign.value?.questions ?? []).map((q) => [q.id, q])))

async function act(action: 'pause' | 'resume' | 'cancel') {
  if (action === 'cancel' && !window.confirm(t('results.cancelConfirm'))) return
  try {
    await api(`/campaigns/${id}/${action}`, { method: 'POST' })
    await Promise.all([load(), session.refresh()])
  } catch (e) {
    error.value = errorText(e)
  }
}

async function addSlots() {
  const n = Number(window.prompt(t('results.addSlotsPrompt'), '1'))
  if (!Number.isInteger(n) || n < 1) return
  try {
    await api(`/campaigns/${id}/slots`, { method: 'POST', json: { add: n } })
    await Promise.all([load(), session.refresh()])
  } catch (e) {
    error.value = errorText(e)
  }
}
</script>

<template>
  <p v-if="!campaign && error" class="card p-6 font-semibold text-danger-ink" role="alert">{{ error }}</p>
  <p v-else-if="!campaign" class="text-muted">{{ $t('common.loading') }}</p>
  <div v-else class="space-y-8">
    <p v-if="published" class="rounded-xl border-2 border-primary-ink p-3 font-semibold text-primary-ink" role="status">🚀 {{ $t('wizard.published') }}</p>
    <header class="flex flex-wrap items-end justify-between gap-4">
      <div>
        <p class="text-sm font-semibold text-muted">{{ $t('results.title') }} · {{ $t(`studio.status.${campaign.status}`) }}</p>
        <h1 class="h1">{{ campaign.game.title }} · {{ campaign.buildLabel }}</h1>
        <p class="mt-1 text-muted">
          {{ $t('results.slotsPaid', { paid: slotsPaid, total: campaign.slotsTotal }) }} · {{ $t('studio.escrow', { n: campaign.escrow }) }} ·
          {{ $t('common.credits', campaign.price) }}
        </p>
      </div>
      <div class="flex flex-wrap gap-2">
        <RouterLink :to="`/c/${campaign.id}`" class="btn btn-ghost">{{ $t('common.open') }}</RouterLink>
        <button v-if="campaign.status === 'live'" type="button" class="btn btn-secondary" @click="act('pause')">{{ $t('results.pause') }}</button>
        <button v-if="campaign.status === 'paused'" type="button" class="btn btn-secondary" @click="act('resume')">{{ $t('results.resume') }}</button>
        <button v-if="['live', 'paused', 'completed'].includes(campaign.status)" type="button" class="btn btn-secondary" @click="addSlots">
          ＋ {{ $t('results.addSlots') }}
        </button>
        <button v-if="['live', 'paused'].includes(campaign.status)" type="button" class="btn btn-danger" @click="act('cancel')">{{ $t('results.cancel') }}</button>
      </div>
    </header>
    <p v-if="error" class="font-semibold text-danger-ink" role="alert">{{ error }}</p>

    <section class="space-y-3">
      <h2 class="h2">{{ $t('results.playtests') }}</h2>
      <p v-if="!rows.length" class="card p-6 text-muted">{{ $t('results.noPlaytests') }}</p>
      <div v-else class="card overflow-x-auto">
        <table class="w-full min-w-[720px] text-left">
          <thead class="border-b-2 border-line text-sm text-muted">
            <tr>
              <th class="p-3">{{ $t('results.tester') }}</th>
              <th class="p-3">{{ $t('results.played') }}</th>
              <th class="p-3">{{ $t('results.answered') }}</th>
              <th class="p-3">{{ $t('results.credits') }}</th>
              <th class="p-3">{{ $t('results.recording') }}</th>
              <th class="p-3"><span class="sr-only">{{ $t('results.view') }}</span></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="p in rows" :key="p.id" class="border-b border-line last:border-0" data-testid="playtest-row">
              <td class="p-3">
                <RouterLink :to="`/u/${p.tester.id}`" class="font-semibold underline">{{ p.tester.name }}</RouterLink>
                <span class="block text-sm text-muted">{{ $t('profile.reputation') }} {{ reputationScore(p.tester.repUp, p.tester.repDown) }}%</span>
              </td>
              <td class="p-3 font-mono">{{ p.activeMs !== null ? formatDuration(p.activeMs) : '—' }}</td>
              <td class="p-3">{{ p.submittedAt ? `${p.answered} / ${p.totalQuestions}` : '—' }}</td>
              <td class="p-3">
                <span class="chip font-semibold" :class="statusClass[statusKey(p)] ?? 'border-warn-ink text-warn-ink'">
                  <span aria-hidden="true">{{ statusIcon[statusKey(p)] ?? '!' }}</span>
                  {{ $t(`results.status.${statusKey(p)}`) }}{{ p.creditsAwarded ? ` · ${p.creditsAwarded}` : '' }}
                </span>
              </td>
              <td class="p-3 text-sm">
                <span v-if="p.recordingDeleted" class="text-muted">{{ $t('results.deleted') }}</span>
                <span v-else-if="p.recordingExpiresAt" class="font-semibold text-warn-ink">{{ $t('results.expiresIn', { when: rel(p.recordingExpiresAt) }) }}</span>
                <span v-else>—</span>
              </td>
              <td class="p-3 text-right">
                <RouterLink v-if="p.submittedAt" :to="`/studio/playtests/${p.id}`" class="btn btn-primary min-h-9 py-1">{{ $t('results.view') }}</RouterLink>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <section v-if="rows.some((r) => r.submittedAt)" class="space-y-3">
      <h2 class="h2">{{ $t('results.aggregates') }}</h2>
      <div class="grid gap-4 lg:grid-cols-2">
        <article v-for="a in aggregates" :key="a.questionId" class="card space-y-3 p-5">
          <h3 class="font-semibold">{{ questionById.get(a.questionId) ? qt.text(questionById.get(a.questionId)!) : a.questionId }}</h3>
          <template v-if="questionById.get(a.questionId)?.type !== 'text'">
            <p class="font-display text-2xl font-bold">
              {{ a.average !== null ? $t('results.average', { n: a.average.toFixed(1) }) : '—' }}
              <span class="text-base font-medium text-muted">· {{ $t('results.responses', a.count) }}</span>
            </p>
            <ul class="space-y-1" :aria-label="$t('results.aggregates')">
              <li v-for="v in questionById.get(a.questionId)?.type === 'yesno' ? [0, 1] : [1, 2, 3, 4, 5]" :key="v" class="flex items-center gap-2 text-sm">
                <span class="w-36 shrink-0">{{ $t(`question.${questionById.get(a.questionId)?.type}.${v}`) }}</span>
                <span class="h-3 flex-1 overflow-hidden rounded-full bg-surface-2">
                  <span class="block h-full bg-primary" :style="{ width: `${a.count ? ((a.distribution[v] ?? 0) / a.count) * 100 : 0}%` }" />
                </span>
                <span class="w-6 text-right font-mono">{{ a.distribution[v] ?? 0 }}</span>
              </li>
            </ul>
            <p v-if="a.na" class="text-sm text-muted">{{ $t('results.naCount', { n: a.na }) }}</p>
          </template>
          <details v-if="a.texts.length" :open="questionById.get(a.questionId)?.type === 'text'">
            <summary class="cursor-pointer font-semibold">{{ $t('results.comments') }} ({{ a.texts.length }})</summary>
            <ul class="mt-2 space-y-2">
              <li v-for="tx in a.texts" :key="tx.playtestId" class="rounded-xl bg-surface-2 p-3">
                <p class="whitespace-pre-line">{{ tx.text }}</p>
                <RouterLink :to="`/studio/playtests/${tx.playtestId}`" class="text-sm text-muted underline">— {{ tx.tester }}</RouterLink>
              </li>
            </ul>
          </details>
        </article>
      </div>
    </section>
  </div>
</template>
