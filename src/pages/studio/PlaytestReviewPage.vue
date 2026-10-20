<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute } from 'vue-router'
import { reputationScore } from '@shared/rules'
import type { PlaytestDetail } from '@shared/types'
import { useErrorText } from '@/composables/useErrorText'
import { useQuestionText } from '@/composables/useQuestionText'
import { useRelativeTime } from '@/composables/useRelativeTime'
import { api } from '@/lib/api'
import { formatDuration } from '@/lib/format'
import { useSession } from '@/stores/session'

const route = useRoute()
const { t } = useI18n()
const session = useSession()
const errorText = useErrorText()
const qt = useQuestionText()
const rel = useRelativeTime()
const id = String(route.params.id)
const pt = ref<PlaytestDetail | null>(null)
const role = ref<'owner' | 'tester'>('tester')
const error = ref('')
const notice = ref('')
const video = ref<HTMLVideoElement>()
const ratingNote = ref('')
let viewedSent = false

onMounted(async () => {
  try {
    const r = await api<{ playtest: PlaytestDetail; role: 'owner' | 'tester' }>(`/playtests/${id}`)
    pt.value = r.playtest
    role.value = r.role
    ratingNote.value = r.playtest.devRatingNote
  } catch (e) {
    error.value = errorText(e)
  }
})

const answersById = computed(() => new Map((pt.value?.answers ?? []).map((a) => [a.questionId, a])))

function jump(ms: number) {
  if (!video.value) return
  video.value.currentTime = ms / 1000
  void video.value.play()
}

function onPlay() {
  if (viewedSent || role.value !== 'owner') return
  viewedSent = true
  void api(`/playtests/${id}/viewed`, { method: 'POST' })
}

async function rate(rating: 1 | -1) {
  if (!pt.value) return
  const next = pt.value.devRating === rating ? null : rating
  await api(`/playtests/${id}/rate`, { method: 'POST', json: { rating: next, note: ratingNote.value } })
  pt.value.devRating = next
  notice.value = t('common.saved')
}

async function deleteRecording() {
  if (!window.confirm(t('review.deleteConfirm'))) return
  try {
    const r = await api<{ bonus: number }>(`/playtests/${id}/recording`, { method: 'DELETE' })
    if (pt.value) {
      pt.value.recordingDeleted = true
      pt.value.recordingUrl = null
    }
    notice.value = r.bonus ? t('review.tidyBonus', { n: r.bonus }) : t('review.deletedOk')
    void session.refresh()
  } catch (e) {
    error.value = errorText(e)
  }
}
</script>

<template>
  <p v-if="!pt && error" class="card p-6 font-semibold text-danger-ink" role="alert">{{ error }}</p>
  <p v-else-if="!pt" class="text-muted">{{ $t('common.loading') }}</p>
  <div v-else class="space-y-6">
    <RouterLink v-if="role === 'owner'" :to="`/studio/campaigns/${pt.campaignId}`" class="font-semibold underline">← {{ $t('review.back') }}</RouterLink>
    <RouterLink v-else to="/studio?tab=tested" class="font-semibold underline" data-testid="back-tested">← {{ $t('studio.backTested') }}</RouterLink>
    <header class="flex flex-wrap items-end justify-between gap-3">
      <div>
        <p class="text-sm font-semibold text-muted">{{ pt.campaign.game.title }} · {{ pt.campaign.buildLabel }}</p>
        <h1 class="h1">{{ $t('review.title', { name: pt.tester.name }) }}</h1>
        <p class="mt-1 text-muted">
          {{ $t('review.playedFor', { time: formatDuration(pt.activeMs ?? 0) }) }} · {{ pt.answered }} / {{ pt.totalQuestions }} ·
          {{ $t(`results.status.${pt.payoutReason ?? 'in_progress'}`) }}
          <span v-if="pt.usedMic"> · 🎙 {{ $t('review.mic') }}</span>
        </p>
      </div>
      <span class="chip">{{ $t('profile.reputation') }} {{ reputationScore(pt.tester.repUp, pt.tester.repDown) }}%</span>
    </header>
    <p v-if="notice" class="rounded-xl border-2 border-primary-ink p-3 font-semibold text-primary-ink" role="status">{{ notice }}</p>
    <p v-if="error" class="font-semibold text-danger-ink" role="alert">{{ error }}</p>

    <div class="grid gap-6 lg:grid-cols-[1fr_340px]">
      <section class="space-y-3">
        <div class="card overflow-hidden bg-black">
          <video
            v-if="pt.recordingUrl"
            ref="video"
            :src="pt.recordingUrl"
            controls
            preload="metadata"
            class="aspect-video w-full"
            data-testid="recording"
            @play="onPlay"
          />
          <p v-else class="grid aspect-video place-items-center p-6 text-center text-white">
            {{ pt.recordingDeleted && pt.recordingBytes ? $t('review.recordingGone') : $t('review.recordingMissing') }}
          </p>
        </div>
        <div v-if="pt.recordingUrl && role === 'owner'" class="flex flex-wrap items-center justify-between gap-3">
          <p v-if="pt.recordingExpiresAt" class="font-semibold text-warn-ink">{{ $t('review.expires', { when: rel(pt.recordingExpiresAt) }) }}</p>
          <button type="button" class="btn btn-danger" data-testid="delete-recording" @click="deleteRecording">🗑 {{ $t('review.deleteRecording') }}</button>
        </div>
      </section>

      <aside class="space-y-4">
        <section class="card p-4">
          <h2 class="h3">{{ $t('review.notes') }}</h2>
          <p v-if="!pt.notes.length" class="mt-1 text-muted">{{ $t('review.noNotes') }}</p>
          <ul class="mt-2 space-y-1">
            <li v-for="n in pt.notes" :key="n.id">
              <button
                type="button"
                class="flex w-full gap-3 rounded-lg p-2 text-left hover:bg-surface-2 disabled:opacity-60"
                :disabled="!pt.recordingUrl"
                :aria-label="$t('review.jump', { time: formatDuration(n.offsetMs) })"
                data-testid="note-jump"
                @click="jump(n.offsetMs)"
              >
                <span class="font-mono font-semibold text-primary-ink">{{ formatDuration(n.offsetMs) }}</span>
                <span>{{ n.text || '⚑' }}</span>
              </button>
            </li>
          </ul>
        </section>
        <section v-if="role === 'owner'" class="card space-y-3 p-4">
          <h2 class="h3">{{ $t('review.rateTitle') }}</h2>
          <p class="text-sm text-muted">{{ $t('review.rateHint') }}</p>
          <div class="flex gap-2">
            <button type="button" class="btn flex-1 border-2" :class="pt.devRating === 1 ? 'border-primary bg-primary text-on-primary' : 'border-line'" :aria-pressed="pt.devRating === 1" @click="rate(1)">
              👍 {{ $t('review.helpful') }}
            </button>
            <button type="button" class="btn flex-1 border-2" :class="pt.devRating === -1 ? 'border-accent bg-accent text-on-accent' : 'border-line'" :aria-pressed="pt.devRating === -1" @click="rate(-1)">
              👎 {{ $t('review.notHelpful') }}
            </button>
          </div>
          <label class="block">
            <span class="field-label text-sm">{{ $t('review.rateNote') }}</span>
            <textarea v-model="ratingNote" class="input min-h-16" maxlength="500" @blur="pt.devRating !== null && rate(pt.devRating)" />
          </label>
        </section>
      </aside>
    </div>

    <section class="space-y-3">
      <h2 class="h2">{{ $t('review.answers') }}</h2>
      <article v-for="(q, i) in pt.campaign.questions.filter((x) => answersById.has(x.id) || x.required)" :key="q.id" class="card p-5">
        <p class="font-semibold">{{ i + 1 }}. {{ qt.text(q) }}</p>
        <template v-if="answersById.get(q.id)">
          <p v-if="answersById.get(q.id)!.na" class="mt-2 font-semibold text-muted">{{ $t('common.na') }}</p>
          <p v-else-if="q.type !== 'text' && answersById.get(q.id)!.value !== null" class="mt-2">
            <span class="pill-credit">{{ q.type === 'yesno' ? '' : `${answersById.get(q.id)!.value} · ` }}{{ $t(`question.${q.type}.${answersById.get(q.id)!.value}`) }}</span>
          </p>
          <p v-if="answersById.get(q.id)!.text" class="mt-2 whitespace-pre-line">{{ answersById.get(q.id)!.text }}</p>
        </template>
        <p v-else class="mt-2 text-muted">{{ $t('review.noAnswer') }}</p>
      </article>
    </section>
  </div>
</template>
