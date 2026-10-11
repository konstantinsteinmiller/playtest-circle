<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { reputationScore } from '@shared/rules'
import type { PublicUser } from '@shared/types'
import { api } from '@/lib/api'

const route = useRoute()
const data = ref<{ user: PublicUser; joinedAt: number; paidTests: number; earned: number } | null>(null)

async function load() {
  data.value = await api(`/users/${route.params.id}`)
}
onMounted(load)
watch(() => route.params.id, load)
</script>

<template>
  <div v-if="data" class="mx-auto max-w-2xl space-y-6">
    <header class="flex items-center gap-4">
      <img
        v-if="data.user.avatarUrl"
        :src="data.user.avatarUrl"
        :alt="$t('profile.avatarAlt', { name: data.user.name })"
        class="size-20 rounded-full border-2 border-line"
        referrerpolicy="no-referrer"
      />
      <div>
        <h1 class="h1">{{ data.user.name }}</h1>
        <p class="text-muted">{{ $t('profile.joined', { date: $d(new Date(data.joinedAt)) }) }}</p>
      </div>
    </header>
    <div class="grid gap-4 sm:grid-cols-3">
      <div class="card p-5">
        <p class="text-sm font-semibold text-muted">{{ $t('profile.reputation') }}</p>
        <p class="font-display text-4xl font-bold text-primary-ink">{{ reputationScore(data.user.repUp, data.user.repDown) }}%</p>
        <p class="text-sm text-muted">{{ $t('profile.repHint', data.user.repUp + data.user.repDown) }}</p>
      </div>
      <div class="card p-5">
        <p class="text-sm font-semibold text-muted">{{ $t('profile.tests') }}</p>
        <p class="font-display text-4xl font-bold">{{ data.paidTests }}</p>
      </div>
      <div class="card p-5">
        <p class="text-sm font-semibold text-muted">{{ $t('profile.earned') }}</p>
        <p class="font-display text-4xl font-bold">{{ data.earned }}</p>
      </div>
    </div>
  </div>
  <p v-else class="text-muted">{{ $t('common.loading') }}</p>
</template>
