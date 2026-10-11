<script setup lang="ts">
withDefaults(defineProps<{ size?: number; wordmark?: boolean; responsive?: boolean }>(), { size: 40, wordmark: true, responsive: false })
</script>

<template>
  <span class="inline-flex items-center gap-3">
    <svg :width="size" :height="size" viewBox="0 0 64 64" aria-hidden="true" class="shrink-0">
      <circle cx="32" cy="32" r="31" fill="#0B0B10" />
      <path d="M32 9a23 23 0 0 1 21.6 15.2" fill="none" stroke="#C6FF3D" stroke-width="6" stroke-linecap="round" />
      <path d="M56.6 17.4 54.3 27.6 45 22.8z" fill="#C6FF3D" />
      <path d="M32 55a23 23 0 0 1-21.6-15.2" fill="none" stroke="#FF3DA5" stroke-width="6" stroke-linecap="round" />
      <path d="M7.4 46.6 9.7 36.4 19 41.2z" fill="#FF3DA5" />
      <path d="M26 21.5v21l17-10.5z" fill="#F7F7F2" />
    </svg>
    <span v-if="wordmark" class="flex-col leading-none" :class="responsive ? 'hidden sm:flex' : 'flex'">
      <span class="font-display text-lg font-bold tracking-tight whitespace-nowrap">{{ $t('brand.name') }}</span>
      <span class="hidden text-xs font-medium text-muted sm:block">{{ $t('brand.tagline') }}</span>
    </span>
  </span>
</template>
