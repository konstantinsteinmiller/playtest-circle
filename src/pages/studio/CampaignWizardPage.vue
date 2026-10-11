<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'
import { CATALOG, CATEGORIES, type AnswerType } from '@shared/questions'
import {
  MAX_CUSTOM_QUESTIONS,
  PLAYTIME_PRESETS,
  PRICE_MAX,
  PRICE_MIN,
  PRICE_PRESETS,
  SLOTS_MAX,
  escrowFor,
  type PlaytimePresetId,
} from '@shared/rules'
import type { CampaignInput, Game } from '@shared/types'
import StepNav from '@/components/StepNav.vue'
import { useErrorText } from '@/composables/useErrorText'
import { api } from '@/lib/api'
import { useSession } from '@/stores/session'

const route = useRoute()
const router = useRouter()
const session = useSession()
const { t } = useI18n()
const errorText = useErrorText()

const games = ref<Game[]>([])
const step = ref(0)
const busy = ref(false)
const error = ref('')
const justCreated = route.query.created === '1'

const form = reactive({
  gameId: typeof route.query.game === 'string' ? route.query.game : '',
  buildLabel: '',
  buildUrl: '',
  instructions: '',
  catalogIds: [] as string[],
  custom: [] as { text: string; type: AnswerType; allowNa: boolean }[],
  playtimePreset: 'quick' as PlaytimePresetId,
  slots: 3,
  price: 10,
  minReputation: 0,
})

onMounted(async () => {
  const [g] = await Promise.all([api<{ games: Game[] }>('/games'), session.refresh()])
  games.value = g.games
  if (!form.gameId && g.games.length) form.gameId = g.games[0].id
})

const steps = computed(() => ['build', 'questions', 'playtime', 'pricing', 'review'].map((s) => t(`wizard.steps.${s}`)))
const total = computed(() => escrowFor(form.slots, form.price))
const balance = computed(() => session.me?.credits ?? 0)
const affordable = computed(() => total.value <= balance.value)
const questionCount = computed(() => form.catalogIds.length + form.custom.length)
const game = computed(() => games.value.find((g) => g.id === form.gameId))
const stepValid = computed(() => {
  if (step.value === 0) return !!form.gameId && form.buildLabel.trim().length > 0
  if (step.value === 1) return questionCount.value > 0 && form.custom.every((c) => c.text.trim().length >= 3)
  if (step.value === 3) return affordable.value && form.price >= PRICE_MIN && form.price <= PRICE_MAX && form.slots >= 1
  return true
})

function toggle(id: string) {
  const i = form.catalogIds.indexOf(id)
  if (i >= 0) form.catalogIds.splice(i, 1)
  else form.catalogIds.push(id)
}

async function publish() {
  busy.value = true
  error.value = ''
  const body: CampaignInput = {
    gameId: form.gameId,
    buildLabel: form.buildLabel,
    buildUrl: form.buildUrl.trim() || null,
    instructions: form.instructions,
    playtimePreset: form.playtimePreset,
    slots: form.slots,
    price: form.price,
    minReputation: form.minReputation,
    catalogIds: form.catalogIds,
    custom: form.custom,
  }
  try {
    const r = await api<{ id: string }>('/campaigns', { method: 'POST', json: body })
    await session.refresh()
    router.push(`/studio/campaigns/${r.id}?published=1`)
  } catch (e) {
    error.value = errorText(e, 'wizard.errors')
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="mx-auto max-w-4xl space-y-6">
    <header>
      <h1 class="h1">{{ $t('wizard.title') }}</h1>
      <p class="mt-1 text-muted">{{ $t('wizard.lead') }}</p>
    </header>
    <p v-if="justCreated" class="rounded-xl border-2 border-primary-ink p-3 font-semibold text-primary-ink" role="status">✓ {{ $t('game.created') }}</p>
    <StepNav :steps="steps" :current="step" @go="step = $event" />

    <div v-if="!games.length" class="card space-y-3 p-6">
      <p>{{ $t('wizard.noGame') }}</p>
      <RouterLink to="/studio/games/new" class="btn btn-primary">{{ $t('studio.newGame') }}</RouterLink>
    </div>

    <form v-else class="card space-y-6 p-6" @submit.prevent="step < 4 ? stepValid && step++ : publish()">
      <!-- 1 Build -->
      <template v-if="step === 0">
        <label class="block">
          <span class="field-label">{{ $t('wizard.game') }}</span>
          <select v-model="form.gameId" class="input" data-testid="wizard-game">
            <option v-for="g in games" :key="g.id" :value="g.id">{{ g.title }}</option>
          </select>
        </label>
        <label class="block">
          <span class="field-label">{{ $t('wizard.buildLabel') }}</span>
          <input v-model="form.buildLabel" class="input" maxlength="60" :placeholder="$t('wizard.buildLabelPlaceholder')" required data-testid="build-label" />
        </label>
        <label class="block">
          <span class="field-label">{{ $t('wizard.buildUrl') }} <span class="font-normal text-muted">({{ $t('common.optional') }})</span></span>
          <input v-model="form.buildUrl" type="url" class="input" :placeholder="game?.playUrl" />
          <span class="field-hint">{{ $t('wizard.buildUrlHint') }}</span>
        </label>
        <label class="block">
          <span class="field-label">{{ $t('wizard.instructions') }} <span class="font-normal text-muted">({{ $t('common.optional') }})</span></span>
          <textarea v-model="form.instructions" class="input min-h-28" maxlength="2000" />
          <span class="field-hint">{{ $t('wizard.instructionsHint') }}</span>
        </label>
      </template>

      <!-- 2 Questions -->
      <template v-else-if="step === 1">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <p class="max-w-2xl text-muted">{{ $t('wizard.catalogLead') }}</p>
          <span class="chip border-primary-ink font-semibold text-primary-ink" aria-live="polite">{{ $t('wizard.selected', { n: questionCount }) }}</span>
        </div>
        <section v-for="cat in CATEGORIES" :key="cat" class="space-y-2">
          <h2 class="h3">{{ $t(`catalog.categories.${cat}`) }}</h2>
          <div class="grid gap-2 md:grid-cols-2">
            <label
              v-for="q in CATALOG.filter((x) => x.category === cat)"
              :key="q.id"
              class="flex cursor-pointer gap-3 rounded-xl border-2 p-3"
              :class="form.catalogIds.includes(q.id) ? 'border-primary-ink bg-surface-2' : 'border-line hover:border-ink'"
            >
              <input
                type="checkbox"
                class="mt-1 size-5 shrink-0 accent-[var(--c-primary-ink)]"
                :checked="form.catalogIds.includes(q.id)"
                :data-testid="`q-${q.id}`"
                @change="toggle(q.id)"
              />
              <span>
                <span class="block font-semibold">{{ $t(`catalog.${q.id}.text`) }}</span>
                <span class="block text-sm text-muted">{{ $t(`question.types.${q.type}`) }} · {{ $t(`catalog.${q.id}.hint`) }}</span>
              </span>
            </label>
          </div>
        </section>
        <section class="space-y-3">
          <h2 class="h3">{{ $t('wizard.custom') }}</h2>
          <p class="text-muted">{{ $t('wizard.customHint', { n: MAX_CUSTOM_QUESTIONS }) }}</p>
          <div v-for="(c, i) in form.custom" :key="i" class="grid gap-2 rounded-xl border-2 border-line p-3 md:grid-cols-[1fr_auto_auto_auto]">
            <label>
              <span class="sr-only">{{ $t('wizard.customText') }}</span>
              <input v-model="c.text" class="input" maxlength="300" :placeholder="$t('wizard.customText')" />
            </label>
            <label>
              <span class="sr-only">{{ $t('wizard.customType') }}</span>
              <select v-model="c.type" class="input">
                <option v-for="ty in ['scale5', 'feeling5', 'yesno', 'text'] as const" :key="ty" :value="ty">{{ $t(`question.types.${ty}`) }}</option>
              </select>
            </label>
            <label class="flex items-center gap-2 text-sm">
              <input v-model="c.allowNa" type="checkbox" class="size-5 accent-[var(--c-primary-ink)]" />{{ $t('wizard.allowNa') }}
            </label>
            <button type="button" class="btn btn-ghost" @click="form.custom.splice(i, 1)">{{ $t('common.remove') }}</button>
          </div>
          <button
            v-if="form.custom.length < MAX_CUSTOM_QUESTIONS"
            type="button"
            class="btn btn-secondary"
            @click="form.custom.push({ text: '', type: 'scale5', allowNa: false })"
          >
            ＋ {{ $t('wizard.addCustom') }}
          </button>
        </section>
      </template>

      <!-- 3 Playtime -->
      <template v-else-if="step === 2">
        <p class="text-muted">{{ $t('wizard.playtimeLead') }}</p>
        <div class="grid gap-3 md:grid-cols-2" role="radiogroup" :aria-label="$t('campaign.playtime')">
          <button
            v-for="p in PLAYTIME_PRESETS"
            :key="p.id"
            type="button"
            role="radio"
            :aria-checked="form.playtimePreset === p.id"
            class="rounded-2xl border-2 p-5 text-left"
            :class="form.playtimePreset === p.id ? 'border-primary bg-primary text-on-primary' : 'border-line hover:border-ink'"
            @click="form.playtimePreset = p.id"
          >
            <span class="block font-display text-xl font-bold">{{ $t(`presets.playtime.${p.id}`) }}</span>
            <span class="block">{{ $t(`presets.playtimeHint.${p.id}`) }}</span>
          </button>
        </div>
      </template>

      <!-- 4 Pricing -->
      <template v-else-if="step === 3">
        <div class="space-y-2">
          <span class="field-label">{{ $t('wizard.price') }}</span>
          <div class="grid gap-2 sm:grid-cols-4" role="radiogroup" :aria-label="$t('wizard.price')">
            <button
              v-for="p in PRICE_PRESETS"
              :key="p.id"
              type="button"
              role="radio"
              :aria-checked="form.price === p.price"
              class="rounded-xl border-2 p-3 text-left"
              :class="form.price === p.price ? 'border-primary bg-primary text-on-primary' : 'border-line hover:border-ink'"
              @click="form.price = p.price"
            >
              <span class="block font-display text-lg font-bold">{{ $t(`presets.price.${p.id}`) }} · {{ p.price }}</span>
              <span class="block text-sm">{{ $t(`presets.priceHint.${p.id}`) }}</span>
            </button>
          </div>
          <label class="block max-w-xs">
            <span class="field-label text-sm">{{ $t('presets.price.custom') }}</span>
            <input v-model.number="form.price" type="number" class="input" :min="PRICE_MIN" :max="PRICE_MAX" step="1" data-testid="price" />
            <span class="field-hint">{{ $t('wizard.priceHint', { min: PRICE_MIN, max: PRICE_MAX }) }}</span>
          </label>
        </div>
        <label class="block max-w-xs">
          <span class="field-label">{{ $t('wizard.slots') }}</span>
          <input v-model.number="form.slots" type="number" class="input" min="1" :max="SLOTS_MAX" step="1" data-testid="slots" />
        </label>
        <label class="block max-w-xs">
          <span class="field-label">{{ $t('wizard.minRep') }}</span>
          <input v-model.number="form.minReputation" type="number" class="input" min="0" max="90" step="5" />
          <span class="field-hint">{{ $t('wizard.minRepHint') }}</span>
        </label>
        <dl class="grid gap-3 rounded-2xl bg-surface-2 p-4 sm:grid-cols-3">
          <div>
            <dt class="text-sm text-muted">{{ $t('wizard.total') }}</dt>
            <dd class="font-display text-2xl font-bold">{{ $t('common.credits', total) }}</dd>
          </div>
          <div>
            <dt class="text-sm text-muted">{{ $t('wizard.balance') }}</dt>
            <dd class="font-display text-2xl font-bold">{{ $t('common.credits', balance) }}</dd>
          </div>
          <div>
            <dt class="text-sm text-muted">{{ $t('wizard.after') }}</dt>
            <dd class="font-display text-2xl font-bold" :class="affordable ? 'text-primary-ink' : 'text-danger-ink'">{{ balance - total }}</dd>
          </div>
        </dl>
        <p v-if="!affordable" class="font-semibold text-danger-ink" role="alert">{{ $t('wizard.notEnough') }}</p>
      </template>

      <!-- 5 Review -->
      <template v-else>
        <dl class="grid gap-4 sm:grid-cols-2">
          <div>
            <dt class="text-sm text-muted">{{ $t('wizard.game') }}</dt>
            <dd class="font-semibold">{{ game?.title }} · {{ form.buildLabel }}</dd>
          </div>
          <div>
            <dt class="text-sm text-muted">{{ $t('campaign.playtime') }}</dt>
            <dd class="font-semibold">{{ $t(`presets.playtime.${form.playtimePreset}`) }}</dd>
          </div>
          <div>
            <dt class="text-sm text-muted">{{ $t('wizard.steps.questions') }}</dt>
            <dd class="font-semibold">{{ $t('wizard.reviewQuestions', { n: questionCount }) }}</dd>
          </div>
          <div>
            <dt class="text-sm text-muted">{{ $t('wizard.total') }}</dt>
            <dd class="font-semibold">{{ form.slots }} × {{ $t('common.credits', form.price) }} = {{ $t('common.credits', total) }}</dd>
          </div>
        </dl>
      </template>

      <p v-if="error" class="font-semibold text-danger-ink" role="alert">{{ error }}</p>
      <div class="flex justify-between gap-3">
        <button v-if="step > 0" type="button" class="btn btn-secondary" @click="step--">{{ $t('common.back') }}</button>
        <span v-else />
        <button v-if="step < 4" type="submit" class="btn btn-primary" :disabled="!stepValid" data-testid="next">{{ $t('common.next') }}</button>
        <button v-else type="submit" class="btn btn-primary" :disabled="busy" data-testid="publish">
          🚀 {{ busy ? $t('wizard.publishing') : $t('wizard.publish') }}
        </button>
      </div>
    </form>
  </div>
</template>
