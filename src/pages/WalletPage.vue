<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import type { LedgerRow } from '@shared/types'
import { api } from '@/lib/api'
import { useErrorText } from '@/composables/useErrorText'
import { useSession } from '@/stores/session'

interface MyTest {
  id: string
  status: string
  credits_awarded: number
  payout_reason: string | null
  submitted_at: number | null
  created_at: number
  title: string
  campaign_id: string
  price: number
}

const session = useSession()
const { t, te, d } = useI18n()
const rows = ref<LedgerRow[]>([])
const tests = ref<MyTest[]>([])
const errorText = useErrorText()

interface SocialState {
  claims: { id: string; url: string; credits: number; createdAt: number }[]
  credits: number
  maxPerUser: number
  until: number
  open: boolean
}
const social = ref<SocialState | null>(null)
const socialUrl = ref('')
const socialBusy = ref(false)
const socialMsg = ref('')
const socialErr = ref('')

async function loadSocial() {
  social.value = await api<SocialState>('/me/social-claims')
}

async function claimSocial() {
  socialBusy.value = true
  socialMsg.value = ''
  socialErr.value = ''
  try {
    const r = await api<{ credits: number }>('/me/social-claims', { method: 'POST', json: { url: socialUrl.value } })
    socialMsg.value = t('wallet.social.done', { n: r.credits })
    socialUrl.value = ''
    const [l] = await Promise.all([api<{ rows: LedgerRow[] }>('/me/ledger'), loadSocial(), session.refresh()])
    rows.value = l.rows
  } catch (e) {
    socialErr.value = errorText(e)
  } finally {
    socialBusy.value = false
  }
}

onMounted(async () => {
  const [l, p] = await Promise.all([api<{ rows: LedgerRow[] }>('/me/ledger'), api<{ playtests: MyTest[] }>('/playtests/mine'), session.refresh()])
  rows.value = l.rows
  tests.value = p.playtests
  await loadSocial().catch(() => {})
})

function reason(r: string) {
  const base = r.split(':')[0]
  const label = te(`wallet.reasons.${base}`) ? t(`wallet.reasons.${base}`) : base
  const note = r.includes(':') ? r.slice(r.indexOf(':') + 1) : ''
  return note ? `${label} — ${note}` : label
}

function testStatus(x: MyTest) {
  if (x.status === 'expired') return t('results.status.expired')
  if (!x.submitted_at) return t('results.status.in_progress')
  return t(`results.status.${x.payout_reason ?? 'paid'}`)
}
</script>

<template>
  <div class="space-y-8">
    <header class="flex flex-wrap items-end justify-between gap-4">
      <h1 class="h1">{{ $t('wallet.title') }}</h1>
      <div class="card p-5 text-right">
        <p class="text-sm font-semibold text-muted">{{ $t('wallet.balance') }}</p>
        <p class="font-display text-4xl font-bold text-primary-ink" data-testid="balance">◎ {{ session.me?.credits ?? 0 }}</p>
      </div>
    </header>
    <p class="text-sm text-muted">{{ $t('wallet.roadmapNote') }}</p>

    <section v-if="social?.open" class="card space-y-3 border-primary p-6" data-testid="social-claim">
      <h2 class="h2">{{ $t('wallet.social.title', { n: social.credits }) }}</h2>
      <p>{{ $t('wallet.social.body', { n: social.credits, max: social.maxPerUser, date: d(new Date(social.until - 1), { dateStyle: 'long' } as never) }) }}</p>
      <p class="text-sm font-semibold text-muted">{{ $t('wallet.social.used', { used: social.claims.length, max: social.maxPerUser }) }}</p>
      <ul v-if="social.claims.length" class="space-y-1 text-sm">
        <li v-for="c in social.claims" :key="c.id" class="truncate">
          ✓ <a :href="c.url" target="_blank" rel="noopener noreferrer" class="underline">{{ c.url }}</a> · +{{ c.credits }}
        </li>
      </ul>
      <form v-if="social.claims.length < social.maxPerUser" class="flex flex-wrap items-end gap-3" @submit.prevent="claimSocial">
        <label class="block min-w-0 flex-1">
          <span class="field-label">{{ $t('wallet.social.label') }}</span>
          <input v-model="socialUrl" type="url" required class="input" :placeholder="$t('wallet.social.placeholder')" data-testid="social-url" />
        </label>
        <button type="submit" class="btn btn-primary" :disabled="socialBusy || !socialUrl.trim()" data-testid="social-submit">
          {{ $t('wallet.social.submit', { n: social.credits }) }}
        </button>
      </form>
      <p v-else class="font-semibold text-primary-ink">{{ $t('wallet.social.maxed', { max: social.maxPerUser }) }}</p>
      <p v-if="socialMsg" class="font-semibold text-primary-ink" role="status">{{ socialMsg }}</p>
      <p v-if="socialErr" class="font-semibold text-danger-ink" role="alert">{{ socialErr }}</p>
    </section>

    <div class="grid gap-8 lg:grid-cols-2">
      <section class="space-y-3">
        <h2 class="h2">{{ $t('wallet.history') }}</h2>
        <p v-if="!rows.length" class="card p-6 text-muted">{{ $t('wallet.empty') }}</p>
        <ul v-else class="card divide-y divide-line">
          <li v-for="r in rows" :key="r.id" class="flex items-center justify-between gap-3 p-4">
            <div>
              <p class="font-semibold">{{ reason(r.reason) }}</p>
              <p class="text-sm text-muted">{{ d(new Date(r.createdAt), { dateStyle: 'medium', timeStyle: 'short' } as never) }}</p>
            </div>
            <span class="font-display text-xl font-bold" :class="r.delta > 0 ? 'text-primary-ink' : 'text-accent-ink'">
              {{ r.delta > 0 ? '+' : '−' }}{{ Math.abs(r.delta) }}
            </span>
          </li>
        </ul>
      </section>
      <section class="space-y-3">
        <h2 class="h2">{{ $t('wallet.myTests') }}</h2>
        <p v-if="!tests.length" class="card p-6 text-muted">{{ $t('wallet.noTests') }}</p>
        <ul v-else class="card divide-y divide-line">
          <li v-for="x in tests" :key="x.id" class="flex items-center justify-between gap-3 p-4">
            <div>
              <RouterLink :to="['reserved', 'recording'].includes(x.status) ? `/play/${x.id}` : `/c/${x.campaign_id}`" class="font-semibold underline">{{
                x.title
              }}</RouterLink>
              <p class="text-sm text-muted">{{ testStatus(x) }}</p>
            </div>
            <span v-if="x.credits_awarded" class="font-display text-xl font-bold text-primary-ink">+{{ x.credits_awarded }}</span>
          </li>
        </ul>
      </section>
    </div>
  </div>
</template>
