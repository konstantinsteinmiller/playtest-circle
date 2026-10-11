<script setup lang="ts">
import { useTheme, type ThemePref } from '@/composables/useTheme'

const { pref } = useTheme()
const options: { id: ThemePref; icon: string }[] = [
  { id: 'dark', icon: 'M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z' },
  { id: 'light', icon: 'M12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10zm0-5v3m0 14v3M4.2 4.2l2.1 2.1m11.4 11.4 2.1 2.1M2 12h3m14 0h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1' },
  { id: 'system', icon: 'M3 4h18v12H3zM8 20h8M12 16v4' },
]
</script>

<template>
  <div role="radiogroup" :aria-label="$t('theme.label')" class="inline-flex rounded-xl border-2 border-line p-0.5">
    <button
      v-for="o in options"
      :key="o.id"
      type="button"
      role="radio"
      :aria-checked="pref === o.id"
      :title="$t(`theme.${o.id}`)"
      class="grid size-9 place-items-center rounded-lg"
      :class="pref === o.id ? 'bg-primary text-on-primary' : 'text-ink hover:bg-surface-2'"
      @click="pref = o.id"
    >
      <svg viewBox="0 0 24 24" class="size-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
        <path :d="o.icon" />
      </svg>
      <span class="sr-only">{{ $t(`theme.${o.id}`) }}</span>
    </button>
  </div>
</template>
