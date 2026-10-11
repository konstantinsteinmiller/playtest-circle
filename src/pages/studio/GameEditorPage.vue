<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'
import { MAX_HOVER_CLIP_BYTES, MAX_IMAGE_BYTES, MAX_SCREENSHOTS } from '@shared/rules'
import type { Game, GameHost, GameInput } from '@shared/types'
import MediaUpload from '@/components/MediaUpload.vue'
import StepNav from '@/components/StepNav.vue'
import { useErrorText } from '@/composables/useErrorText'
import { useDraft } from '@/composables/useDraft'
import { api } from '@/lib/api'

const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const errorText = useErrorText()
const editId = computed(() => (route.params.id ? String(route.params.id) : null))

const hosts: GameHost[] = ['itch', 'steam', 'wavedash', 'crazygames', 'newgrounds', 'own', 'other']
const form = reactive({
  title: '',
  pitch: '',
  description: '',
  tagsText: '',
  playUrl: '',
  host: 'itch' as GameHost,
  accessNotes: '',
  trailerUrl: '',
})
const cover = ref<{ key: string; url: string } | null>(null)
const clip = ref<{ key: string; url: string } | null>(null)
const shots = ref<{ key: string; url: string }[]>([])
const step = ref(0)
const saving = ref(false)
const error = ref('')
const steps = computed(() => [t('game.steps.basics'), t('game.steps.link'), t('game.steps.media'), t('game.steps.review')])
const restored = ref(false)

type GameDraft = { form: typeof form; cover: typeof cover.value; clip: typeof clip.value; shots: typeof shots.value; step: number }
const draft = useDraft<GameDraft>(
  `game:${editId.value ?? 'new'}`,
  () => ({ form: { ...form }, cover: cover.value, clip: clip.value, shots: shots.value, step: step.value }),
  (d) => {
    Object.assign(form, d.form)
    cover.value = d.cover
    clip.value = d.clip
    shots.value = d.shots
    step.value = d.step
    restored.value = true
  },
)

function discardDraft() {
  draft.discard()
  window.location.reload()
}

onMounted(async () => {
  if (!editId.value) {
    draft.restore()
    return
  }
  const r = await api<{ game: Game; keys: { coverKey: string | null; hoverClipKey: string | null; screenshotKeys: string[] } }>(`/games/${editId.value}`)
  const g = r.game
  Object.assign(form, {
    title: g.title,
    pitch: g.pitch,
    description: g.description,
    tagsText: g.tags.join(', '),
    playUrl: g.playUrl,
    host: g.host,
    accessNotes: g.accessNotes,
    trailerUrl: g.trailerUrl ?? '',
  })
  cover.value = r.keys.coverKey ? { key: r.keys.coverKey, url: g.coverUrl! } : null
  clip.value = r.keys.hoverClipKey ? { key: r.keys.hoverClipKey, url: g.hoverClipUrl! } : null
  shots.value = r.keys.screenshotKeys.map((k, i) => ({ key: k, url: g.screenshots[i] }))
  // Unsaved edits win over the stored version.
  draft.restore()
})

const tags = computed(() =>
  form.tagsText
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
    .slice(0, 8),
)
const stepValid = computed(() => {
  if (step.value === 0) return form.title.trim().length >= 2 && form.pitch.trim().length >= 10
  if (step.value === 1) return /^https?:\/\/.+\..+/.test(form.playUrl.trim())
  return true
})

async function save() {
  saving.value = true
  error.value = ''
  const body: GameInput = {
    title: form.title,
    pitch: form.pitch,
    description: form.description,
    tags: tags.value,
    playUrl: form.playUrl.trim(),
    host: form.host,
    accessNotes: form.accessNotes,
    trailerUrl: form.trailerUrl.trim() || null,
    coverKey: cover.value?.key ?? null,
    hoverClipKey: clip.value?.key ?? null,
    screenshotKeys: shots.value.map((s) => s.key),
  }
  try {
    const r = editId.value
      ? await api<{ id: string }>(`/games/${editId.value}`, { method: 'PUT', json: body })
      : await api<{ id: string }>('/games', { method: 'POST', json: body })
    draft.discard()
    router.push(editId.value ? '/studio' : `/studio/campaigns/new?game=${r.id}&created=1`)
  } catch (e) {
    error.value = errorText(e)
  } finally {
    saving.value = false
  }
}

async function archive() {
  if (!editId.value || !window.confirm(t('studio.archiveConfirm'))) return
  try {
    await api(`/games/${editId.value}`, { method: 'DELETE' })
    router.push('/studio')
  } catch (e) {
    error.value = errorText(e)
  }
}
</script>

<template>
  <div class="mx-auto max-w-3xl space-y-6">
    <header>
      <h1 class="h1">{{ editId ? $t('game.editTitle') : $t('game.createTitle') }}</h1>
      <p class="mt-1 text-muted">{{ $t('game.lead') }} · {{ $t('common.approxTime', { n: 5 }) }}</p>
    </header>
    <StepNav :steps="steps" :current="step" @go="step = $event" />
    <p v-if="restored" class="flex flex-wrap items-center justify-between gap-3 rounded-xl border-2 border-info-ink p-3 font-semibold text-info-ink" role="status">
      {{ $t('draft.restored') }}
      <button type="button" class="btn btn-ghost min-h-9 py-1" @click="discardDraft">{{ $t('draft.discard') }}</button>
    </p>

    <form class="card space-y-5 p-6" @submit.prevent="step < 3 ? stepValid && step++ : save()">
      <template v-if="step === 0">
        <label class="block">
          <span class="field-label">{{ $t('game.title') }}</span>
          <input v-model="form.title" class="input" maxlength="80" required data-testid="game-title" />
        </label>
        <label class="block">
          <span class="field-label">{{ $t('game.pitch') }}</span>
          <input v-model="form.pitch" class="input" maxlength="160" required data-testid="game-pitch" />
          <span class="field-hint">{{ $t('game.pitchHint') }}</span>
        </label>
        <label class="block">
          <span class="field-label">{{ $t('game.description') }} <span class="font-normal text-muted">({{ $t('common.optional') }})</span></span>
          <textarea v-model="form.description" class="input min-h-32" maxlength="4000" />
          <span class="field-hint">{{ $t('game.descriptionHint') }}</span>
        </label>
        <label class="block">
          <span class="field-label">{{ $t('game.tags') }}</span>
          <input v-model="form.tagsText" class="input" />
          <span class="field-hint">{{ $t('game.tagsHint') }}</span>
        </label>
      </template>

      <template v-else-if="step === 1">
        <label class="block">
          <span class="field-label">{{ $t('game.playUrl') }}</span>
          <input v-model="form.playUrl" type="url" class="input" placeholder="https://" required data-testid="game-url" />
          <span class="field-hint">{{ $t('game.playUrlHint') }}</span>
        </label>
        <label class="block">
          <span class="field-label">{{ $t('game.host') }}</span>
          <select v-model="form.host" class="input">
            <option v-for="h in hosts" :key="h" :value="h">{{ $t(`hosts.${h}`) }}</option>
          </select>
        </label>
        <label class="block">
          <span class="field-label">{{ $t('game.accessNotes') }} <span class="font-normal text-muted">({{ $t('common.optional') }})</span></span>
          <textarea v-model="form.accessNotes" class="input min-h-20" maxlength="500" />
          <span class="field-hint">{{ $t('game.accessNotesHint') }}</span>
        </label>
      </template>

      <template v-else-if="step === 2">
        <div class="space-y-2">
          <span class="field-label">{{ $t('game.cover') }}</span>
          <img v-if="cover" :src="cover.url" alt="" class="aspect-video w-full max-w-md rounded-xl object-cover" />
          <MediaUpload
            kind="image"
            :label="cover ? $t('game.replace') : $t('game.upload')"
            :hint="$t('game.coverHint')"
            :max-bytes="MAX_IMAGE_BYTES"
            @uploaded="(key, url) => (cover = { key, url })"
          />
        </div>
        <div class="space-y-2">
          <span class="field-label">{{ $t('game.screenshots') }}</span>
          <div v-if="shots.length" class="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <div v-for="(s, i) in shots" :key="s.key" class="relative">
              <img :src="s.url" alt="" class="aspect-video w-full rounded-lg object-cover" />
              <button type="button" class="btn btn-secondary absolute top-1 right-1 min-h-8 px-2 py-0 text-sm" @click="shots.splice(i, 1)">
                {{ $t('common.remove') }}
              </button>
            </div>
          </div>
          <MediaUpload
            v-if="shots.length < MAX_SCREENSHOTS"
            kind="image"
            multiple
            :label="$t('game.upload')"
            :hint="$t('game.screenshotsHint', { n: MAX_SCREENSHOTS })"
            :max-bytes="MAX_IMAGE_BYTES"
            @uploaded="(key, url) => shots.length < MAX_SCREENSHOTS && shots.push({ key, url })"
          />
        </div>
        <label class="block">
          <span class="field-label">{{ $t('game.trailerUrl') }} <span class="font-normal text-muted">({{ $t('common.optional') }})</span></span>
          <input v-model="form.trailerUrl" type="url" class="input" placeholder="https://youtube.com/watch?v=…" />
          <span class="field-hint">{{ $t('game.trailerHint') }}</span>
        </label>
        <div class="space-y-2">
          <span class="field-label">{{ $t('game.hoverClip') }} <span class="font-normal text-muted">({{ $t('common.optional') }})</span></span>
          <video v-if="clip" :src="clip.url" muted loop autoplay playsinline class="aspect-video w-full max-w-md rounded-xl object-cover" />
          <MediaUpload
            kind="clip"
            :label="clip ? $t('game.replace') : $t('game.upload')"
            :hint="$t('game.hoverClipHint')"
            :max-bytes="MAX_HOVER_CLIP_BYTES"
            @uploaded="(key, url) => (clip = { key, url })"
          />
        </div>
      </template>

      <template v-else>
        <p class="text-muted">{{ $t('game.reviewLead') }}</p>
        <article class="card max-w-sm overflow-hidden">
          <img v-if="cover" :src="cover.url" alt="" class="aspect-video w-full object-cover" />
          <div class="space-y-2 p-4">
            <h2 class="h3">{{ form.title }}</h2>
            <p>{{ form.pitch }}</p>
            <div class="flex flex-wrap gap-2">
              <span class="chip">{{ $t(`hosts.${form.host}`) }}</span>
              <span v-for="tag in tags" :key="tag" class="chip text-muted">#{{ tag }}</span>
            </div>
          </div>
        </article>
      </template>

      <p v-if="error" class="font-semibold text-danger-ink" role="alert">{{ error }}</p>
      <div class="flex flex-wrap justify-between gap-3 pt-2">
        <button v-if="step > 0" type="button" class="btn btn-secondary" @click="step--">{{ $t('common.back') }}</button>
        <button v-else-if="editId" type="button" class="btn btn-danger" @click="archive">{{ $t('studio.archive') }}</button>
        <span v-else />
        <button v-if="step < 3" type="submit" class="btn btn-primary" :disabled="!stepValid" data-testid="next">{{ $t('common.next') }}</button>
        <button v-else type="submit" class="btn btn-primary" :disabled="saving" data-testid="save-game">{{ $t('game.save') }}</button>
      </div>
    </form>
  </div>
</template>
