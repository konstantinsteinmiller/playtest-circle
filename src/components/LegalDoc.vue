<script setup lang="ts">
defineProps<{ doc: 'privacy' | 'terms' | 'imprint'; sections: number }>()
</script>

<template>
  <article class="mx-auto max-w-3xl space-y-6">
    <h1 class="h1">{{ $t(`legal.${doc}Title`) }}</h1>
    <p class="text-sm text-muted">{{ $t('legal.updated') }}</p>
    <section v-for="i in sections" :key="i" class="space-y-2">
      <h2 class="h3">{{ $t(`legal.${doc}.s${i}Title`) }}</h2>
      <p class="whitespace-pre-line">{{ $t(`legal.${doc}.s${i}Body`) }}</p>
    </section>
  </article>
</template>
