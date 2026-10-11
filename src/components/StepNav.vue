<script setup lang="ts">
defineProps<{ steps: string[]; current: number }>()
defineEmits<{ go: [index: number] }>()
</script>

<template>
  <ol class="flex flex-wrap gap-2" role="list">
    <li v-for="(s, i) in steps" :key="s">
      <button
        type="button"
        class="flex min-h-11 items-center gap-2 rounded-xl border-2 px-3 py-1.5 font-semibold"
        :class="
          i === current
            ? 'border-primary bg-primary text-on-primary'
            : i < current
              ? 'border-line bg-surface text-ink hover:border-ink'
              : 'border-line bg-canvas text-muted'
        "
        :aria-current="i === current ? 'step' : undefined"
        :disabled="i > current"
        @click="$emit('go', i)"
      >
        <span class="grid size-6 place-items-center rounded-full border-2 border-current text-sm" aria-hidden="true">{{ i < current ? '✓' : i + 1 }}</span>
        {{ s }}
      </button>
    </li>
  </ol>
</template>
