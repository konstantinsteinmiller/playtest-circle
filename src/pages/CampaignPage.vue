<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { reputationScore } from '@shared/rules'
import type { CampaignDetail } from '@shared/types'
import { useErrorText } from '@/composables/useErrorText'
import { useQuestionText } from '@/composables/useQuestionText'
import { api } from '@/lib/api'
import { embedUrl } from '@/lib/embed'
import { useSession } from '@/stores/session'

const route = useRoute()
const router = useRouter()
const session = useSession()
const errorText = useErrorText()
const qt = useQuestionText()
const c = ref<CampaignDetail | null>(null)
const error = ref('')
const starting = ref(false)
const lightbox = ref<string | null>(null)

onMounted(async () => {
  try {
    c.value = (await api<{ campaign: CampaignDetail }>(`/campaigns/${route.params.id}`)).campaign
  } catch (e) {
    error.value = errorText(e)
  }
})

const trailer = computed(() => embedUrl(c.value?.game.trailerUrl ?? null))
const directTrailer = computed(() => (c.value?.game.trailerUrl && !trailer.value ? c.value.game.trailerUrl : null))
const isOwn = computed(() => c.value?.owner.id === session.me?.id)
const myRep = computed(() => (session.me ? reputationScore(session.me.repUp, session.me.repDown) : 0))
const visibleQuestions = computed(() => c.value?.questions.filter((q) => q.source !== 'system' || q.id === 'sys_overall') ?? [])
const blocker = computed(() => {
  const x = c.value
  if (!x) return ''
  if (isOwn.value) return 'campaign.ownCampaign'
  if (x.myPlaytestStatus && !['reserved', 'recording'].includes(x.myPlaytestStatus)) return 'campaign.alreadyTested'
  if (x.myPlaytestId) return ''
  if (x.status !== 'live') return 'campaign.notLive'
  if (x.slotsLeft <= 0) return 'campaign.full'
  if (x.minReputation > 0 && myRep.value < x.minReputation) return 'campaign.repTooLow'
  return ''
})

async function start() {
  if (!c.value) return
  starting.value = true
  error.value = ''
  try {
    const r = await api<{ id: string }>(`/campaigns/${c.value.id}/start`, { method: 'POST' })
    router.push(`/play/${r.id}`)
  } catch (e) {
    error.value = errorText(e)
  } finally {
    starting.value = false
  }
}
</script>

<template>
  <p v-if="!c && error" class="card p-6 font-semibold text-danger-ink" role="alert">{{ error }}</p>
  <p v-else-if="!c" class="text-muted">{{ $t('common.loading') }}</p>
  <div v-else class="grid gap-8 lg:grid-cols-[1fr_380px]">
    <div class="min-w-0 space-y-8">
      <header class="space-y-3">
        <p class="text-muted">
          <RouterLink :to="`/u/${c.owner.id}`" class="underline">{{ $t('browse.by', { name: c.owner.name }) }}</RouterLink>
          · {{ $t(`hosts.${c.game.host}`) }}
        </p>
        <h1 class="h1">{{ c.game.title }}</h1>
        <p class="text-lg">{{ c.game.pitch }}</p>
        <div class="flex flex-wrap gap-2">
          <span v-for="tag in c.game.tags" :key="tag" class="chip">#{{ tag }}</span>
        </div>
      </header>

      <section v-if="trailer || directTrailer || c.game.coverUrl" class="space-y-3">
        <h2 class="h2">{{ $t('campaign.trailer') }}</h2>
        <div class="card aspect-video overflow-hidden">
          <iframe
            v-if="trailer"
            :src="trailer"
            :title="$t('campaign.trailer')"
            class="size-full"
            allow="accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture; fullscreen"
            allowfullscreen
            loading="lazy"
          />
          <video v-else-if="directTrailer" :src="directTrailer" controls class="size-full bg-black" />
          <img v-else :src="c.game.coverUrl!" :alt="$t('campaign.coverAlt', { title: c.game.title })" class="size-full object-cover" />
        </div>
      </section>

      <section v-if="c.game.screenshots.length" class="space-y-3">
        <h2 class="h2">{{ $t('campaign.screenshots') }}</h2>
        <div class="grid grid-cols-2 gap-3 md:grid-cols-3">
          <button v-for="(s, i) in c.game.screenshots" :key="s" type="button" class="card overflow-hidden" @click="lightbox = s">
            <img :src="s" :alt="$t('campaign.screenshotAlt', { n: i + 1, title: c.game.title })" class="aspect-video w-full object-cover" loading="lazy" />
          </button>
        </div>
      </section>

      <section v-if="c.game.description" class="space-y-3">
        <h2 class="h2">{{ $t('campaign.about') }}</h2>
        <p class="whitespace-pre-line">{{ c.game.description }}</p>
      </section>

      <section class="space-y-3">
        <h2 class="h2">{{ $t('campaign.whatYoullBeAsked') }}</h2>
        <ol class="space-y-2">
          <li v-for="(q, i) in visibleQuestions" :key="q.id" class="card flex gap-3 p-4">
            <span class="font-display font-bold text-primary-ink" aria-hidden="true">{{ i + 1 }}.</span>
            <div>
              <p class="font-semibold">{{ qt.text(q) }}</p>
              <p v-if="qt.hint(q)" class="text-sm text-muted">{{ qt.hint(q) }}</p>
            </div>
          </li>
        </ol>
      </section>
    </div>

    <aside class="space-y-4 lg:sticky lg:top-24 lg:self-start">
      <div class="card space-y-5 p-6">
        <div>
          <p class="text-sm font-semibold text-muted">{{ $t('campaign.reward') }}</p>
          <p class="pill-credit mt-1 text-2xl">◎ {{ $t('common.credits', c.price) }}</p>
        </div>
        <dl class="grid grid-cols-2 gap-4">
          <div>
            <dt class="text-sm text-muted">{{ $t('campaign.playtime') }}</dt>
            <dd class="font-semibold">{{ $t(`presets.playtime.${c.playtimePreset}`) }}</dd>
          </div>
          <div>
            <dt class="text-sm text-muted">{{ $t('campaign.build') }}</dt>
            <dd class="font-semibold">{{ c.buildLabel }}</dd>
          </div>
          <div class="col-span-2">
            <dd class="font-semibold text-info-ink">{{ $t('campaign.minPlaytime', { n: c.minMinutes }) }}</dd>
            <dd class="text-sm text-muted">{{ $t('campaign.slots', { left: c.slotsLeft, total: c.slotsTotal }) }}</dd>
            <dd v-if="c.minReputation" class="text-sm text-muted">{{ $t('campaign.minRep', { n: c.minReputation }) }}</dd>
          </div>
        </dl>
        <div>
          <h2 class="font-semibold">{{ $t('campaign.instructions') }}</h2>
          <p class="mt-1 whitespace-pre-line text-muted">{{ c.instructions || $t('campaign.noInstructions') }}</p>
        </div>
        <div v-if="c.game.accessNotes">
          <h2 class="font-semibold">{{ $t('campaign.accessNotes') }}</h2>
          <p class="mt-1 whitespace-pre-line text-muted">{{ c.game.accessNotes }}</p>
        </div>
        <p class="rounded-xl bg-surface-2 p-3 text-sm">{{ $t('campaign.beforeYouStart') }}</p>
        <p v-if="blocker" class="font-semibold text-warn-ink">{{ $t(blocker, { n: c.minReputation }) }}</p>
        <RouterLink v-else-if="c.myPlaytestId" :to="`/play/${c.myPlaytestId}`" class="btn btn-primary w-full text-lg">
          {{ $t('campaign.continuePlaytest') }}
        </RouterLink>
        <button v-else type="button" class="btn btn-primary w-full text-lg" :disabled="starting" data-testid="start-playtest" @click="start">
          ▶ {{ $t('campaign.startPlaytest') }}
        </button>
        <p v-if="error" class="font-semibold text-danger-ink" role="alert">{{ error }}</p>
      </div>
    </aside>

    <div v-if="lightbox" class="fixed inset-0 z-40 grid place-items-center bg-black/85 p-4" role="dialog" aria-modal="true" @click="lightbox = null">
      <img :src="lightbox" alt="" class="max-h-[90vh] max-w-full rounded-xl" />
      <button type="button" class="btn btn-secondary absolute top-4 right-4" @click="lightbox = null">{{ $t('common.close') }}</button>
    </div>
  </div>
</template>
