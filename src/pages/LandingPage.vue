<script setup lang="ts">
import OnboardingVideo from '@/components/OnboardingVideo.vue'
import GoogleIcon from '@/components/GoogleIcon.vue'
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
/** A guest tried to open the studio: posting a game needs the Google account. */
const needGoogle = computed(() => route.query.need === 'google')
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
        <p v-if="needGoogle" class="rounded-xl border-2 border-info-ink p-3 font-semibold text-info-ink" role="status" data-testid="need-google">
          {{ $t('landing.needGoogle') }}
        </p>
        <div class="flex flex-wrap gap-3">
          <RouterLink v-if="!needGoogle" to="/browse" class="btn btn-primary text-lg" data-testid="browse-cta">
            {{ session.signedIn ? $t('landing.ctaSignedIn') : $t('landing.ctaBrowse') }}
          </RouterLink>
          <template v-if="!session.member">
            <a v-if="session.config.googleConfigured" :href="session.loginUrl(returnTo)" class="btn text-lg" :class="needGoogle ? 'btn-primary' : 'btn-secondary'">
              <GoogleIcon />
              {{ session.me?.guest ? $t('landing.ctaLinkGuest') : $t('landing.cta') }}
            </a>
            <p v-else class="rounded-xl border-2 border-line p-3 text-muted">{{ $t('landing.loginNotConfigured') }}</p>
          </template>
          <RouterLink to="/how-it-works" class="btn btn-secondary text-lg">{{ $t('landing.secondary') }}</RouterLink>
        </div>
        <form v-if="session.config.devLogin && !session.member" class="flex flex-wrap items-end gap-2" @submit.prevent="devLogin">
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
      <OnboardingVideo class="mx-auto max-w-3xl" />
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
