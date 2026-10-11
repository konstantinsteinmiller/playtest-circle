<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { api, ApiError } from '@/lib/api'
import { formatBytes } from '@/lib/format'

interface AdminUser {
  id: string
  name: string
  email: string
  role: string
  credits: number
  rep_up: number
  rep_down: number
  banned_at: number | null
  ban_reason: string | null
  paid_tests: number
  warnings: number
}
interface AdminCampaign {
  id: string
  status: string
  hidden_at: number | null
  price: number
  slots_total: number
  slots_paid: number
  title: string
  owner: string
}

const { t } = useI18n()
const users = ref<AdminUser[]>([])
const campaigns = ref<AdminCampaign[]>([])
const storage = ref({ bytes: 0, n: 0, budget: 1 })

const blocked = ref<'' | 'auth' | 'disabled'>('')

async function load() {
  let r
  try {
    r = await api<{ users: AdminUser[]; campaigns: AdminCampaign[]; storage: { bytes: number; n: number; budget: number } }>('/admin/overview')
  } catch (e) {
    blocked.value = e instanceof ApiError && e.status === 404 ? 'disabled' : 'auth'
    return
  }
  blocked.value = ''
  users.value = r.users
  campaigns.value = r.campaigns
  storage.value = r.storage
}
onMounted(load)

async function grant(u: AdminUser) {
  const amount = Number(window.prompt(t('admin.grantPrompt'), '10'))
  if (!Number.isInteger(amount) || amount === 0) return
  await api(`/admin/users/${u.id}/grant`, { method: 'POST', json: { amount } })
  await load()
}
async function ban(u: AdminUser) {
  let reason = ''
  if (!u.banned_at) {
    const answer = window.prompt(t('admin.banPrompt', { name: u.name }), '')
    if (answer === null) return
    reason = answer
  }
  await api(`/admin/users/${u.id}/ban`, { method: 'POST', json: { banned: !u.banned_at, reason } })
  await load()
}
async function warn(u: AdminUser) {
  const reason = window.prompt(t('admin.warnPrompt', { name: u.name }), '')
  if (!reason || reason.trim().length < 3) return
  await api(`/admin/users/${u.id}/warn`, { method: 'POST', json: { reason } })
  await load()
}
async function hide(c: AdminCampaign) {
  await api(`/admin/campaigns/${c.id}/hide`, { method: 'POST', json: { hidden: !c.hidden_at } })
  await load()
}
</script>

<template>
  <div class="space-y-8">
    <h1 class="h1">{{ $t('admin.title') }}</h1>
    <p v-if="blocked" class="card p-5 font-semibold text-warn-ink" role="alert" data-testid="admin-blocked">
      {{ blocked === 'disabled' ? $t('admin.disabled') : $t('admin.authRequired') }}
    </p>
    <template v-else>
    <p class="card p-4 font-semibold">{{ $t('admin.storage', { used: formatBytes(storage.bytes), budget: formatBytes(storage.budget) }) }} ({{ storage.n }})</p>
    <section class="space-y-3">
      <h2 class="h2">{{ $t('admin.users') }}</h2>
      <div class="card overflow-x-auto">
        <table class="w-full min-w-[640px] text-left">
          <thead class="border-b-2 border-line text-sm text-muted">
            <tr>
              <th class="p-3">{{ $t('admin.name') }}</th>
              <th class="p-3">{{ $t('admin.email') }}</th>
              <th class="p-3">{{ $t('admin.balance') }}</th>
              <th class="p-3">{{ $t('profile.tests') }}</th>
              <th class="p-3">{{ $t('admin.warnings') }}</th>
              <th class="p-3"><span class="sr-only">{{ $t('common.edit') }}</span></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="u in users" :key="u.id" class="border-b border-line last:border-0">
              <td class="p-3 font-semibold">
                {{ u.name }} <span v-if="u.banned_at" class="chip text-danger-ink">{{ $t('admin.bannedChip') }}</span>
                <span v-if="u.ban_reason" class="block text-sm font-normal text-muted">{{ $t('admin.reason', { reason: u.ban_reason }) }}</span>
              </td>
              <td class="p-3">{{ u.email }}</td>
              <td class="p-3 font-mono">{{ u.credits }}</td>
              <td class="p-3">{{ u.paid_tests }}</td>
              <td class="p-3" data-testid="warn-count">{{ u.warnings }}</td>
              <td class="flex gap-2 p-3">
                <button type="button" class="btn btn-secondary min-h-9 py-1" @click="grant(u)">{{ $t('admin.grant') }}</button>
                <button type="button" class="btn btn-secondary min-h-9 py-1" data-testid="warn" @click="warn(u)">{{ $t('admin.warn') }}</button>
                <button v-if="u.role !== 'admin'" type="button" class="btn btn-danger min-h-9 py-1" data-testid="ban" @click="ban(u)">{{ u.banned_at ? $t('admin.unban') : $t('admin.ban') }}</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
    <section class="space-y-3">
      <h2 class="h2">{{ $t('admin.campaigns') }}</h2>
      <ul class="card divide-y divide-line">
        <li v-for="c in campaigns" :key="c.id" class="flex flex-wrap items-center justify-between gap-3 p-4">
          <RouterLink :to="`/c/${c.id}`" class="font-semibold underline">{{ c.title }}</RouterLink>
          <span class="text-sm text-muted">{{ c.owner }} · {{ $t(`studio.status.${c.status}`) }} · {{ c.slots_paid }}/{{ c.slots_total }} · {{ c.price }}</span>
          <button type="button" class="btn btn-secondary min-h-9 py-1" @click="hide(c)">{{ c.hidden_at ? $t('admin.unhide') : $t('admin.hide') }}</button>
        </li>
      </ul>
    </section>
    </template>
  </div>
</template>
