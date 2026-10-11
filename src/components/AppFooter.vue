<script setup lang="ts">
import { useSession } from '@/stores/session'
import AppLogo from './AppLogo.vue'
import ThemeToggle from './ThemeToggle.vue'

const session = useSession()
</script>

<template>
  <footer class="mt-24 border-t-2 border-line bg-surface">
    <div class="mx-auto grid max-w-7xl gap-8 px-4 py-10 md:grid-cols-[1fr_auto]">
      <div class="max-w-xl space-y-3">
        <AppLogo :size="32" />
        <p class="text-muted">{{ $t('footer.openSource') }}</p>
        <a :href="session.config.githubUrl" class="inline-flex items-center gap-2 font-semibold text-primary-ink underline" rel="noopener" target="_blank">
          <svg viewBox="0 0 24 24" class="size-5" fill="currentColor" aria-hidden="true">
            <path
              d="M12 .5a12 12 0 0 0-3.8 23.4c.6.1.8-.3.8-.6v-2c-3.3.7-4-1.6-4-1.6-.6-1.4-1.4-1.8-1.4-1.8-1-.7.1-.7.1-.7 1.2.1 1.8 1.2 1.8 1.2 1 1.8 2.8 1.3 3.5 1 .1-.8.4-1.3.7-1.6-2.7-.3-5.5-1.3-5.5-5.9 0-1.3.5-2.4 1.2-3.2-.1-.3-.5-1.5.1-3.2 0 0 1-.3 3.3 1.2a11.5 11.5 0 0 1 6 0C17.3 4.7 18.3 5 18.3 5c.7 1.7.2 2.9.1 3.2.8.8 1.2 1.9 1.2 3.2 0 4.6-2.8 5.6-5.5 5.9.4.4.8 1.1.8 2.2v3.3c0 .3.2.7.8.6A12 12 0 0 0 12 .5z"
            />
          </svg>
          {{ $t('footer.github') }}
        </a>
      </div>
      <nav class="flex flex-wrap content-start gap-x-6 gap-y-2 font-semibold">
        <a :href="`${session.config.githubUrl}/blob/main/roadmap.md`" target="_blank" rel="noopener" class="hover:underline">{{ $t('footer.roadmap') }}</a>
        <RouterLink to="/how-it-works" class="hover:underline">{{ $t('nav.howItWorks') }}</RouterLink>
        <RouterLink to="/privacy" class="hover:underline">{{ $t('footer.privacy') }}</RouterLink>
        <RouterLink to="/terms" class="hover:underline">{{ $t('footer.terms') }}</RouterLink>
        <RouterLink to="/imprint" class="hover:underline">{{ $t('footer.imprint') }}</RouterLink>
        <div class="basis-full pt-2"><ThemeToggle /></div>
      </nav>
    </div>
  </footer>
</template>
