<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import type { LedgerRow } from '@shared/types'
import { api } from '@/lib/api'
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

onMounted(async () => {
  const [l, p] = await Promise.all([api<{ rows: LedgerRow[] }>('/me/ledger'), api<{ playtests: MyTest[] }>('/playtests/mine'), session.refresh()])
  rows.value = l.rows
  tests.value = p.playtests
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
