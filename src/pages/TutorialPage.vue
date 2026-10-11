<script setup lang="ts">
import GoogleIcon from '@/components/GoogleIcon.vue'
import { onMounted } from 'vue'
import { WELCOME_GRANT } from '@shared/rules'
import { api } from '@/lib/api'
import { useSession } from '@/stores/session'

const session = useSession()
const steps = [
  { key: 'step1', icon: '🎮' },
  { key: 'step2', icon: '🗂️' },
  { key: 'step3', icon: '🚀' },
  { key: 'step4', icon: '🎬' },
]

onMounted(async () => {
  if (session.me && !session.me.onboarded) {
    await api('/me', { method: 'PATCH', json: { onboarded: true } }).catch(() => {})
    session.me.onboarded = true
  }
})
</script>

<template>
  <div class="mx-auto max-w-3xl space-y-8">
    <header class="space-y-2">
      <h1 class="h1">{{ $t('tutorial.title') }}</h1>
      <p class="text-lg text-muted">{{ $t('tutorial.lead') }}</p>
    </header>
    <ol class="space-y-4">
      <li v-for="s in steps" :key="s.key" class="card flex gap-4 p-6">
        <span class="grid size-14 shrink-0 place-items-center rounded-2xl bg-surface-2 text-3xl" aria-hidden="true">{{ s.icon }}</span>
        <div>
          <h2 class="h3">{{ $t(`tutorial.${s.key}Title`) }}</h2>
          <p class="mt-2 text-muted">{{ $t(`tutorial.${s.key}Body`) }}</p>
        </div>
      </li>
    </ol>
    <section class="card border-primary-ink p-6">
      <h2 class="h3">{{ $t('tutorial.tipsTitle') }}</h2>
      <ul class="mt-3 list-disc space-y-2 pl-5">
        <li>{{ $t('tutorial.tip1', { n: WELCOME_GRANT }) }}</li>
        <li>{{ $t('tutorial.tip2') }}</li>
        <li>{{ $t('tutorial.tip3') }}</li>
        <li>{{ $t('tutorial.tip4') }}</li>
      </ul>
    </section>
    <div v-if="session.signedIn" class="flex flex-wrap gap-3">
      <RouterLink to="/browse" class="btn btn-primary">{{ $t('tutorial.browse') }}</RouterLink>
      <RouterLink to="/studio/games/new" class="btn btn-secondary">{{ $t('tutorial.createGame') }}</RouterLink>
    </div>
    <a v-else :href="session.loginUrl()" class="btn btn-primary"><GoogleIcon />{{ $t('landing.cta') }}</a>
  </div>
</template>
