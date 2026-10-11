<script setup lang="ts">
import { useEventListener, useIntervalFn, useRafFn } from '@vueuse/core'
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'
import { countAnswered, type AnswerInput, type CampaignQuestion } from '@shared/questions'
import type { PayoutReason } from '@shared/rules'
import type { Note, PlaytestDetail } from '@shared/types'
import QuestionField from '@/components/QuestionField.vue'
import { useErrorText } from '@/composables/useErrorText'
import { useBlockerCheck } from '@/composables/useBlockerCheck'
import { useDraft } from '@/composables/useDraft'
import { useQuestionText } from '@/composables/useQuestionText'
import { api } from '@/lib/api'
import { formatDuration } from '@/lib/format'
import { recordingSupported, TabRecorder, WrongSurfaceError, type UploadedPart } from '@/lib/recorder'
import { useSession } from '@/stores/session'

type Phase = 'loading' | 'briefing' | 'recording' | 'finishing' | 'questionnaire' | 'submitting' | 'result' | 'error'

const route = useRoute()
const router = useRouter()
const session = useSession()
const { t } = useI18n()
const errorText = useErrorText()
const qt = useQuestionText()
const id = String(route.params.id)

const phase = ref<Phase>('loading')
const pt = ref<PlaytestDetail | null>(null)
const minuteMs = ref(60_000)
const error = ref('')
const notice = ref('')
const supported = recordingSupported()

const consent = ref(false)
const withMic = ref(false)
const gameOpened = ref(false)

let recorder: TabRecorder | null = null
const elapsed = ref(0)
const micLevel = ref(0)
const hasMic = ref(false)
const upload = ref({ parts: 0, uploading: false, retrying: false })
const parts = ref<UploadedPart[]>([])
const uploadError = ref('')
const blocker = useBlockerCheck()
const recorderMs = ref(0)

const notes = ref<Note[]>([])
const pendingOffset = ref<number | null>(null)
const noteText = ref('')

const answers = ref<Record<string, AnswerInput>>({})
const result = ref<{ reason: PayoutReason; credits: number } | null>(null)

const campaign = computed(() => pt.value?.campaign)
const questions = computed<CampaignQuestion[]>(() => campaign.value?.questions ?? [])
const minMs = computed(() => (campaign.value?.minMinutes ?? 0) * minuteMs.value)
const targetMinutes = computed(() => {
  const p = campaign.value?.playtimePreset
  return p === 'quick' ? 5 : p === 'standard' ? 10 : p === 'deep' ? 20 : null
})
const minReached = computed(() => elapsed.value >= minMs.value)
const quitEarly = computed(() => recorderMs.value < minMs.value)
const progress = computed(() => {
  const goal = (targetMinutes.value ?? (campaign.value?.minMinutes ?? 1) * 2) * minuteMs.value
  return Math.min(100, (elapsed.value / goal) * 100)
})
const minMarker = computed(() => {
  const goal = (targetMinutes.value ?? (campaign.value?.minMinutes ?? 1) * 2) * minuteMs.value
  return Math.min(100, (minMs.value / goal) * 100)
})
const answerList = computed(() => Object.values(answers.value))
const counts = computed(() => countAnswered(questions.value, answerList.value, quitEarly.value))
const missing = computed(() => counts.value.required - counts.value.requiredAnswered)
const isRequired = (q: CampaignQuestion) => q.required || (q.id === 'sys_quit_reason' && quitEarly.value)
const shownQuestions = computed(() => questions.value.filter((q) => q.id !== 'sys_quit_reason' || quitEarly.value))

const draft = useDraft<{ answers: Record<string, AnswerInput>; noteText: string; parts: UploadedPart[]; recorderMs: number }>(
  `playtest:${id}`,
  () => ({ answers: answers.value, noteText: noteText.value, parts: parts.value, recorderMs: recorderMs.value }),
  (d) => {
    // Only answers for questions that still exist; new ones keep their empty default.
    for (const [qid, a] of Object.entries(d.answers)) if (answers.value[qid]) answers.value[qid] = a
    noteText.value = d.noteText
    parts.value = d.parts
    recorderMs.value = d.recorderMs
  },
)

onMounted(async () => {
  void blocker.check()
  try {
    const r = await api<{ playtest: PlaytestDetail; minuteMs: number }>(`/playtests/${id}`)
    pt.value = r.playtest
    minuteMs.value = r.minuteMs
    notes.value = r.playtest.notes
    for (const q of r.playtest.campaign.questions) answers.value[q.id] = { questionId: q.id, value: null, na: false, text: '' }
    const s = r.playtest.status
    const resumable = s === 'recording' && draft.restore() && parts.value.length > 0
    if (resumable) {
      // The recording was already stopped and uploaded before the reload: continue with the questionnaire.
      elapsed.value = recorderMs.value
      phase.value = 'questionnaire'
    } else if (s === 'paid' || s === 'no_payout') {
      draft.discard()
      result.value = { reason: r.playtest.payoutReason ?? 'paid', credits: r.playtest.creditsAwarded }
      phase.value = 'result'
    } else if (s === 'expired' || (r.playtest.reservedUntil ?? 0) < Date.now()) {
      error.value = t('play.reservationExpired')
      phase.value = 'error'
    } else {
      phase.value = 'briefing'
    }
  } catch (e) {
    error.value = errorText(e)
    phase.value = 'error'
  }
})

function openGame() {
  if (!campaign.value) return
  window.open(campaign.value.buildUrl, '_blank', 'noopener')
  gameOpened.value = true
}

async function startRecording() {
  error.value = ''
  notice.value = ''
  recorder = new TabRecorder({
    withMic: withMic.value,
    partUrl: async (partNumber) => (await api<{ url: string }>(`/playtests/${id}/recording/part`, { method: 'POST', json: { partNumber } })).url,
    onProgress: (s) => (upload.value = s),
    onShareEnded: () => {
      if (phase.value === 'recording') {
        notice.value = t('play.shareEnded')
        void finishRecording()
      }
    },
  })
  try {
    // getDisplayMedia first: it needs the click's user activation, which an await would spend.
    await recorder.start()
  } catch (e) {
    recorder = null
    error.value = e instanceof WrongSurfaceError ? t('play.wrongSurface') : t('play.permissionDenied')
    return
  }
  try {
    await api(`/playtests/${id}/recording/start`, { method: 'POST', json: { mime: recorder.mime, usedMic: recorder.hasMic } })
  } catch (e) {
    await recorder.stop()
    recorder = null
    error.value = errorText(e)
    return
  }
  if (recorder.micFailed) notice.value = t('play.micDenied')
  hasMic.value = recorder.hasMic
  notes.value = []
  parts.value = []
  phase.value = 'recording'
}

useIntervalFn(() => {
  if (recorder && phase.value === 'recording') elapsed.value = recorder.elapsedMs()
}, 250)
useRafFn(() => {
  if (recorder && phase.value === 'recording') micLevel.value = recorder.micLevel()
})

function markMoment() {
  pendingOffset.value = recorder?.elapsedMs() ?? 0
  noteText.value = ''
}

async function saveNote() {
  if (pendingOffset.value === null) return
  const offsetMs = pendingOffset.value
  const text = noteText.value.trim()
  pendingOffset.value = null
  const r = await api<{ id: string }>(`/playtests/${id}/notes`, { method: 'POST', json: { offsetMs, text } })
  notes.value = [...notes.value, { id: r.id, offsetMs, text }].sort((a, b) => a.offsetMs - b.offsetMs)
}

async function requestStop() {
  if (!minReached.value && !window.confirm(t('play.stopConfirmEarly', { n: campaign.value?.minMinutes ?? 0 }))) return
  await finishRecording()
}

async function finishRecording() {
  if (!recorder || phase.value !== 'recording') return
  if (pendingOffset.value !== null) await saveNote().catch(() => {})
  phase.value = 'finishing'
  recorderMs.value = recorder.elapsedMs()
  elapsed.value = recorderMs.value
  await api(`/playtests/${id}/recording/stop`, { method: 'POST', json: { recorderMs: recorderMs.value } }).catch(() => {})
  parts.value = await recorder.stop()
  uploadError.value = [recorder.lastUploadError, blocker.blocked.value ? 'blocker detected' : ''].filter(Boolean).join(' · ')
  phase.value = 'questionnaire'
}

async function submit() {
  phase.value = 'submitting'
  error.value = ''
  try {
    const r = await api<{ reason: PayoutReason; credits: number }>(`/playtests/${id}/submit`, {
      method: 'POST',
      json: { answers: answerList.value, parts: parts.value, recorderMs: recorderMs.value, uploadError: uploadError.value },
    })
    result.value = r
    draft.discard()
    phase.value = 'result'
    void session.refresh()
  } catch (e) {
    error.value = errorText(e)
    phase.value = 'questionnaire'
  }
}

async function abandon() {
  if (!window.confirm(t('play.abandonConfirm'))) return
  await recorder?.stop()
  await api(`/playtests/${id}/abandon`, { method: 'POST' }).catch(() => {})
  draft.discard()
  router.push('/browse')
}

const resultText = computed(() => {
  const r = result.value
  if (!r) return ''
  const map: Record<PayoutReason, string> = {
    paid: t('play.resultPaid', { n: r.credits }),
    quit_early: t('play.resultQuitEarly'),
    incomplete: t('play.resultIncomplete'),
    no_recording: t('play.resultNoRecording'),
    implausible_recording: t('play.resultImplausible'),
    interrupted: t('play.resultInterrupted'),
  }
  return map[r.reason]
})

useEventListener(window, 'beforeunload', (e: BeforeUnloadEvent) => {
  if (phase.value === 'recording' || phase.value === 'finishing' || phase.value === 'questionnaire') {
    e.preventDefault()
    e.returnValue = t('play.leaveWarning')
  }
})
onBeforeUnmount(() => void recorder?.stop())
</script>

<template>
  <div class="mx-auto max-w-4xl space-y-6">
    <p v-if="phase === 'loading'" class="text-muted">{{ $t('common.loading') }}</p>

    <div v-else-if="phase === 'error'" class="card space-y-4 p-6">
      <p class="font-semibold text-danger-ink" role="alert">{{ error }}</p>
      <RouterLink to="/browse" class="btn btn-secondary">{{ $t('play.nextTest') }}</RouterLink>
    </div>

    <template v-else-if="campaign">
      <header class="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p class="text-sm font-semibold text-muted">{{ $t('play.title') }} · {{ campaign.buildLabel }}</p>
          <h1 class="h1">{{ campaign.game.title }}</h1>
        </div>
        <span class="pill-credit text-lg">◎ {{ $t('common.credits', campaign.price) }}</span>
      </header>

      <p v-if="notice" class="rounded-xl border-2 border-info-ink p-3 font-semibold text-info-ink" role="status">{{ notice }}</p>

      <!-- Briefing -->
      <template v-if="phase === 'briefing'">
        <p v-if="!supported" class="card border-danger p-5 font-semibold text-danger-ink" role="alert">{{ $t('play.unsupported') }}</p>
        <section v-if="blocker.blocked.value" class="card space-y-2 border-warn-ink p-5" role="alert" data-testid="blocker-warning">
          <h2 class="font-display text-lg font-bold text-warn-ink">⚠ {{ $t('play.blocker.title') }}</h2>
          <p>{{ $t('play.blocker.body') }}</p>
          <button type="button" class="btn btn-secondary min-h-9 py-1" :disabled="blocker.checking.value" @click="blocker.check()">{{ $t('play.blocker.recheck') }}</button>
        </section>

        <section class="card space-y-4 p-6">
          <h2 class="h2">{{ $t('play.briefingTitle') }}</h2>
          <p class="whitespace-pre-line">{{ campaign.instructions || $t('campaign.noInstructions') }}</p>
          <p class="font-semibold text-info-ink">{{ $t('campaign.minPlaytime', { n: campaign.minMinutes }) }}</p>
          <div class="rounded-xl border-2 border-info-ink p-3" data-testid="device-instructions">
            <p class="font-semibold text-info-ink">{{ $t(`devices.${campaign.devices}`) }}</p>
            <p class="text-sm">{{ $t(`devices.howTo.${campaign.devices}`) }}</p>
          </div>
          <div>
            <h3 class="font-semibold">{{ $t('play.questionsReminder') }}</h3>
            <ul class="mt-2 list-disc space-y-1 pl-5 text-muted">
              <li v-for="q in questions.filter((x) => x.source !== 'system')" :key="q.id">{{ qt.text(q) }}</li>
            </ul>
          </div>
        </section>

        <section class="card space-y-4 p-6">
          <h2 class="h3">{{ $t('play.consentTitle') }}</h2>
          <label class="flex items-start gap-3">
            <input v-model="consent" type="checkbox" class="mt-1 size-5 accent-[var(--c-primary-ink)]" data-testid="consent" />
            <span>{{ $t('play.consent') }}</span>
          </label>
          <label class="flex items-start gap-3">
            <input v-model="withMic" type="checkbox" class="mt-1 size-5 accent-[var(--c-primary-ink)]" />
            <span>
              <span class="font-semibold">🎙 {{ $t('play.micLabel') }}</span>
              <span class="block text-sm text-muted">{{ $t('play.micHint') }}</span>
            </span>
          </label>
        </section>

        <div class="grid gap-4 md:grid-cols-2">
          <section class="card space-y-3 p-6" :class="gameOpened && 'border-primary-ink'">
            <h2 class="h3">1 · {{ $t('play.step1') }}</h2>
            <p class="text-muted">{{ $t('play.step1Body') }}</p>
            <button type="button" class="btn btn-secondary w-full" :disabled="!consent" data-testid="open-game" @click="openGame">
              ↗ {{ gameOpened ? $t('play.gameOpened') : $t('play.openGame') }}
            </button>
          </section>
          <section class="card space-y-3 p-6">
            <h2 class="h3">2 · {{ $t('play.step2') }}</h2>
            <p class="text-muted">{{ $t('play.step2Body') }}</p>
            <button
              type="button"
              class="btn btn-primary w-full"
              :disabled="!consent || !gameOpened || !supported"
              data-testid="start-recording"
              @click="startRecording"
            >
              ● {{ $t('play.startRecording') }}
            </button>
          </section>
        </div>
        <p v-if="error" class="font-semibold text-danger-ink" role="alert">{{ error }}</p>
        <button type="button" class="btn btn-ghost text-sm" @click="abandon">{{ $t('play.abandon') }}</button>
      </template>

      <!-- Recording -->
      <template v-else-if="phase === 'recording' || phase === 'finishing'">
        <section class="card space-y-5 p-6" aria-live="off">
          <div class="flex flex-wrap items-center justify-between gap-4">
            <p class="flex items-center gap-2 font-display text-xl font-bold text-danger-ink">
              <span class="size-3 animate-pulse rounded-full bg-danger" aria-hidden="true" />{{ $t('play.recording') }}
            </p>
            <p class="font-display text-5xl font-bold tabular-nums" :aria-label="$t('play.elapsed')" data-testid="elapsed">{{ formatDuration(elapsed) }}</p>
          </div>
          <div class="relative h-4 overflow-hidden rounded-full bg-surface-2" aria-hidden="true">
            <div class="h-full rounded-full transition-all" :class="minReached ? 'bg-primary' : 'bg-info-ink'" :style="{ width: `${progress}%` }" />
            <div class="absolute top-0 h-full w-1 bg-ink" :style="{ left: `${minMarker}%` }" />
          </div>
          <div class="flex flex-wrap justify-between gap-2 text-sm font-semibold">
            <span>{{ $t('play.minTarget', { n: campaign.minMinutes }) }}</span>
            <span v-if="targetMinutes">{{ $t('play.target', { n: targetMinutes }) }}</span>
          </div>
          <p v-if="minReached" class="font-semibold text-primary-ink" role="status">✓ {{ $t('play.minReached') }}</p>
          <div class="flex flex-wrap items-center gap-4 text-sm text-muted">
            <span>{{ upload.retrying ? $t('play.uploadError') : upload.uploading ? $t('play.uploading') : $t('play.uploadedParts', { n: upload.parts }) }}</span>
            <span v-if="hasMic" class="flex items-center gap-2">
              🎙
              <span class="h-2 w-24 overflow-hidden rounded-full bg-surface-2" role="meter" :aria-label="$t('play.micLevel')" :aria-valuenow="Math.round(micLevel * 100)" aria-valuemin="0" aria-valuemax="100">
                <span class="block h-full bg-primary" :style="{ width: `${micLevel * 100}%` }" />
              </span>
            </span>
          </div>
        </section>

        <section class="card space-y-4 p-6">
          <div class="flex flex-wrap items-center gap-3">
            <button type="button" class="btn btn-secondary" :disabled="phase === 'finishing'" data-testid="mark-moment" @click="markMoment">
              ⚑ {{ $t('play.markMoment') }}
            </button>
            <form v-if="pendingOffset !== null" class="flex flex-1 flex-wrap gap-2" @submit.prevent="saveNote">
              <span class="chip self-center font-mono">{{ formatDuration(pendingOffset) }}</span>
              <input v-model="noteText" class="input min-w-48 flex-1" maxlength="500" :placeholder="$t('play.notePlaceholder')" :aria-label="$t('play.notePlaceholder')" data-testid="note-text" />
              <button type="submit" class="btn btn-primary" data-testid="save-note">{{ $t('play.addNote') }}</button>
            </form>
          </div>
          <div>
            <h2 class="h3">{{ $t('play.notes') }}</h2>
            <p v-if="!notes.length" class="mt-1 text-muted">{{ $t('play.noNotes') }}</p>
            <ul class="mt-2 space-y-1">
              <li v-for="n in notes" :key="n.id" class="flex gap-3"><span class="font-mono font-semibold text-primary-ink">{{ formatDuration(n.offsetMs) }}</span>{{ n.text }}</li>
            </ul>
          </div>
        </section>

        <button type="button" class="btn btn-primary w-full py-4 text-xl" :disabled="phase === 'finishing'" data-testid="stop" @click="requestStop">
          ■ {{ phase === 'finishing' ? $t('play.uploading') : $t('play.stop') }}
        </button>
      </template>

      <!-- Questionnaire -->
      <form v-else-if="phase === 'questionnaire' || phase === 'submitting'" class="space-y-4" @submit.prevent="submit">
        <header>
          <h2 class="h2">{{ $t('play.questionnaireTitle') }}</h2>
          <p class="text-muted">{{ $t('play.questionnaireLead') }}</p>
          <p class="mt-1 font-semibold">{{ $t('play.elapsed') }}: {{ formatDuration(recorderMs) }}</p>
        </header>
        <p v-if="quitEarly" class="rounded-xl border-2 border-warn-ink p-3 font-semibold text-warn-ink">{{ $t('play.quitEarlyNotice') }}</p>
        <QuestionField v-for="(q, i) in shownQuestions" :key="q.id" v-model="answers[q.id]" :question="q" :required="isRequired(q)" :index="i" />
        <div class="card sticky bottom-4 flex flex-wrap items-center justify-between gap-3 p-4 shadow-2xl">
          <p class="font-semibold" :class="missing ? 'text-warn-ink' : 'text-primary-ink'" aria-live="polite">
            {{ missing ? $t('play.missing', missing) : '✓' }}
          </p>
          <button type="submit" class="btn btn-primary text-lg" :disabled="phase === 'submitting'" data-testid="submit-feedback">
            {{ phase === 'submitting' ? $t('play.submitting') : $t('play.submit') }}
          </button>
        </div>
        <p v-if="error" class="font-semibold text-danger-ink" role="alert">{{ error }}</p>
      </form>

      <!-- Result -->
      <section v-else-if="phase === 'result'" class="card space-y-5 p-8 text-center" data-testid="result">
        <p class="text-6xl" aria-hidden="true">{{ result?.reason === 'paid' ? '🎉' : '🙏' }}</p>
        <h2 class="h2">{{ $t('play.resultTitle') }}</h2>
        <p class="text-lg">{{ resultText }}</p>
        <div class="flex flex-wrap justify-center gap-3">
          <RouterLink to="/browse" class="btn btn-primary">{{ $t('play.nextTest') }}</RouterLink>
          <RouterLink to="/wallet" class="btn btn-secondary">{{ $t('play.wallet') }}</RouterLink>
        </div>
      </section>
    </template>
  </div>
</template>
