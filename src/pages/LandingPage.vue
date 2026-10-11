<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { WELCOME_GRANT } from '@shared/rules'
import AppLogo from '@/components/AppLogo.vue'
import { api } from '@/lib/api'
import { useSession } from '@/stores/session'

const session = useSession()
const route = useRoute()
const router = useRouter()
const returnTo = computed(() => (typeof route.query.returnTo === 'string' ? route.query.returnTo : '/browse'))
const loginError = computed(() => (typeof route.query.login_error === 'string' ? route.query.login_error : ''))
const devEmail = ref('dev@example.com')

async function devLogin() {
  await api('/auth/dev-login', { method: 'POST', json: { email: devEmail.value } })
  await session.refresh()
  router.push(session.me?.onboarded ? returnTo.value : '/how-it-works')
}

const questions = ['q1', 'q2', 'q3', 'q4', 'q5']
const steps = [
  { n: 1, title: 'landing.step1Title', body: 'landing.step1Body' },
  { n: 2, title: 'landing.step2Title', body: 'landing.step2Body' },
  { n: 3, title: 'landing.step3Title', body: 'landing.step3Body' },
]
</script>

<template>
  <div class="space-y-20">
    <section class="grid items-center gap-10 pt-6 lg:grid-cols-[1.2fr_1fr]">
      <div class="space-y-6">
        <p class="chip border-primary-ink font-semibold text-primary-ink">{{ $t('brand.tagline') }}</p>
        <h1 class="font-display text-4xl leading-tight font-bold tracking-tight sm:text-6xl">{{ $t('landing.title') }}</h1>
        <p class="max-w-2xl text-lg text-muted">{{ $t('landing.lead') }}</p>
        <p v-if="loginError" class="rounded-xl border-2 border-danger p-3 font-semibold text-danger-ink" role="alert">
          {{ loginError === 'banned' ? $t('landing.banned') : $t('landing.loginError', { reason: loginError }) }}
        </p>
        <div class="flex flex-wrap gap-3">
          <RouterLink v-if="session.signedIn" to="/browse" class="btn btn-primary text-lg">{{ $t('landing.ctaSignedIn') }}</RouterLink>
          <a v-else-if="session.config.googleConfigured" :href="session.loginUrl(returnTo)" class="btn btn-primary text-lg">
            <svg viewBox="0 0 24 24" class="size-5" aria-hidden="true">
              <path
                fill="currentColor"
                d="M21.6 12.2c0-.7-.1-1.4-.2-2H12v3.8h5.4a4.6 4.6 0 0 1-2 3v2.5h3.2c1.9-1.7 3-4.3 3-7.3zM12 22c2.7 0 5-.9 6.6-2.4l-3.2-2.5c-.9.6-2 1-3.4 1-2.6 0-4.8-1.8-5.6-4.1H3.1v2.6A10 10 0 0 0 12 22zM6.4 14a6 6 0 0 1 0-3.9V7.5H3.1a10 10 0 0 0 0 9zM12 6c1.5 0 2.8.5 3.8 1.5l2.9-2.9A10 10 0 0 0 3.1 7.5L6.4 10C7.2 7.8 9.4 6 12 6z"
              />
            </svg>
            {{ $t('landing.cta') }}
          </a>
          <p v-else class="rounded-xl border-2 border-line p-3 text-muted">{{ $t('landing.loginNotConfigured') }}</p>
          <RouterLink to="/how-it-works" class="btn btn-secondary text-lg">{{ $t('landing.secondary') }}</RouterLink>
        </div>
        <form v-if="session.config.devLogin && !session.signedIn" class="flex flex-wrap items-end gap-2" @submit.prevent="devLogin">
          <label class="min-w-64">
            <span class="field-label text-sm">{{ $t('landing.devLoginEmail') }}</span>
            <input v-model="devEmail" type="email" class="input" data-testid="dev-email" />
          </label>
          <button type="submit" class="btn btn-secondary" data-testid="dev-login">{{ $t('landing.devLogin') }}</button>
        </form>
        <p class="text-sm text-muted">🔒 {{ $t('landing.gated') }}</p>
      </div>
      <div class="card relative overflow-hidden p-8">
        <div class="absolute -top-16 -right-16 size-56 rounded-full bg-primary opacity-20 blur-3xl" aria-hidden="true" />
        <div class="absolute -bottom-16 -left-16 size-56 rounded-full bg-accent opacity-20 blur-3xl" aria-hidden="true" />
        <div class="relative flex flex-col items-center gap-6 text-center">
          <AppLogo :size="140" :wordmark="false" />
          <h2 class="h2">{{ $t('landing.questionsTitle') }}</h2>
          <ul class="w-full space-y-2 text-left">
            <li v-for="q in questions" :key="q" class="rounded-xl border-2 border-line bg-canvas px-4 py-3 font-semibold">
              “{{ $t(`landing.${q}`) }}”
            </li>
          </ul>
        </div>
      </div>
    </section>

    <section class="space-y-6">
      <h2 class="h2">{{ $t('landing.stepsTitle') }}</h2>
      <div class="grid gap-4 md:grid-cols-3">
        <div v-for="s in steps" :key="s.n" class="card p-6">
          <span class="grid size-12 place-items-center rounded-2xl bg-primary font-display text-2xl font-bold text-on-primary" aria-hidden="true">{{
            s.n
          }}</span>
          <h3 class="h3 mt-4">{{ $t(s.title) }}</h3>
          <p class="mt-2 text-muted">{{ $t(s.body) }}</p>
        </div>
      </div>
    </section>

    <section class="grid gap-4 sm:grid-cols-3">
      <div class="card p-6 text-center">
        <p class="font-display text-5xl font-bold text-primary-ink">{{ WELCOME_GRANT }}</p>
        <p class="mt-1 font-semibold">{{ $t('landing.statWelcome') }}</p>
      </div>
      <div class="card p-6 text-center">
        <p class="font-display text-5xl font-bold text-accent-ink">3</p>
        <p class="mt-1 font-semibold">{{ $t('landing.statRecordings') }}</p>
      </div>
      <div class="card p-6 text-center">
        <p class="font-display text-5xl font-bold text-info-ink">100%</p>
        <p class="mt-1 font-semibold">{{ $t('landing.statOpen') }}</p>
      </div>
    </section>
  </div>
</template>
