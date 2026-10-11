<script setup lang="ts">
import AppFooter from './components/AppFooter.vue'
import AppHeader from './components/AppHeader.vue'
import AppToasts from './components/AppToasts.vue'
</script>

<template>
  <div class="flex min-h-dvh flex-col">
    <AppHeader />
    <main id="main" class="mx-auto w-full max-w-7xl flex-1 px-4 py-8" tabindex="-1">
      <RouterView />
    </main>
    <AppFooter />
    <AppToasts />
  </div>
</template>
