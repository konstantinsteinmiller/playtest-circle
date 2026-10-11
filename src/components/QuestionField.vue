<script setup lang="ts">
import { computed } from 'vue'
import type { AnswerInput, CampaignQuestion } from '@shared/questions'
import { useQuestionText } from '@/composables/useQuestionText'

const props = defineProps<{ question: CampaignQuestion; required: boolean; index: number }>()
const model = defineModel<AnswerInput>({ required: true })
const qt = useQuestionText()

const options = computed(() => {
  const t = props.question.type
  if (t === 'yesno') return [0, 1]
  if (t === 'text') return []
  return [1, 2, 3, 4, 5]
})
const groupId = computed(() => `q-${props.question.id}`)

function pick(v: number) {
  model.value = { ...model.value, value: v, na: false }
}
function pickNa() {
  model.value = { ...model.value, value: null, na: true }
}
</script>

<template>
  <fieldset class="card p-5">
    <legend class="sr-only">{{ qt.text(question) }}</legend>
    <div class="flex items-start gap-3">
      <span class="grid size-8 shrink-0 place-items-center rounded-full bg-surface-2 font-display font-bold" aria-hidden="true">{{ index + 1 }}</span>
      <div class="min-w-0 flex-1">
        <p :id="groupId" class="text-lg font-semibold">
          {{ qt.text(question) }}
          <span v-if="required" class="text-sm font-medium text-accent-ink">({{ $t('common.required') }})</span>
        </p>
        <p v-if="qt.hint(question)" class="mt-1 text-sm text-muted">
          <span class="font-semibold">{{ $t('question.hint') }}:</span> {{ qt.hint(question) }}
        </p>

        <div v-if="options.length" class="mt-4 flex flex-wrap gap-2" role="radiogroup" :aria-labelledby="groupId">
          <button
            v-for="v in options"
            :key="v"
            type="button"
            role="radio"
            :aria-checked="!model.na && model.value === v"
            class="min-h-11 min-w-24 flex-1 rounded-xl border-2 px-3 py-2 text-sm font-semibold sm:flex-none"
            :class="!model.na && model.value === v ? 'border-primary bg-primary text-on-primary' : 'border-line hover:border-ink'"
            @click="pick(v)"
          >
            <span v-if="question.type !== 'yesno'" class="block font-display text-lg leading-none">{{ v }}</span>
            <span class="block">{{ $t(`question.${question.type}.${v}`) }}</span>
          </button>
          <button
            v-if="question.allowNa"
            type="button"
            role="radio"
            :aria-checked="model.na"
            class="min-h-11 rounded-xl border-2 border-dashed px-3 py-2 text-sm font-semibold"
            :class="model.na ? 'border-ink bg-surface-2' : 'border-line hover:border-ink'"
            @click="pickNa"
          >
            {{ $t('common.na') }}
          </button>
        </div>

        <label class="mt-4 block">
          <span class="field-label text-sm">{{ question.type === 'text' ? $t('question.textPlaceholder') : $t('question.comment') }}</span>
          <textarea
            :value="model.text"
            class="input min-h-24"
            maxlength="4000"
            :placeholder="question.type === 'text' ? $t('question.textPlaceholder') : $t('question.commentPlaceholder')"
            @input="model = { ...model, text: ($event.target as HTMLTextAreaElement).value }"
          />
        </label>
      </div>
    </div>
  </fieldset>
</template>
