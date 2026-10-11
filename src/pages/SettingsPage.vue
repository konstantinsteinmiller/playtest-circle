<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import ThemeToggle from '@/components/ThemeToggle.vue'
import { useErrorText } from '@/composables/useErrorText'
import { api } from '@/lib/api'
import { useSession } from '@/stores/session'

const session = useSession()
const router = useRouter()
const { t } = useI18n()
const errorText = useErrorText()
const emailOptIn = ref(true)
const webhook = ref('')
const notice = ref('')
const error = ref('')

onMounted(async () => {
  await session.refresh()
  emailOptIn.value = session.me?.emailOptIn ?? true
  webhook.value = session.me?.discordWebhook ?? ''
})

async function saveEmail() {
  await api('/me', { method: 'PATCH', json: { emailOptIn: emailOptIn.value } })
  notice.value = t('common.saved')
}

async function saveWebhook() {
  error.value = ''
  try {
    await api('/me', { method: 'PATCH', json: { discordWebhook: webhook.value.trim() || null } })
    notice.value = t('common.saved')
  } catch {
    error.value = t('settings.invalidWebhook')
  }
}

async function testWebhook() {
  try {
    const r = await api<{ ok: boolean }>('/me/test-discord', { method: 'POST' })
    notice.value = r.ok ? t('settings.discordTestOk') : t('settings.discordTestFail')
  } catch (e) {
    error.value = errorText(e)
  }
}

async function deleteAccount() {
  if (!window.confirm(t('settings.deleteConfirm'))) return
  await api('/me', { method: 'DELETE' })
  session.me = null
  router.push('/')
}
</script>

<template>
  <div class="mx-auto max-w-2xl space-y-6">
    <h1 class="h1">{{ $t('settings.title') }}</h1>
    <p v-if="notice" class="rounded-xl border-2 border-primary-ink p-3 font-semibold text-primary-ink" role="status">{{ notice }}</p>
    <p v-if="error" class="font-semibold text-danger-ink" role="alert">{{ error }}</p>

    <section class="card space-y-5 p-6">
      <h2 class="h2">{{ $t('settings.notifications') }}</h2>
      <label class="flex items-start gap-3">
        <input v-model="emailOptIn" type="checkbox" class="mt-1 size-5 accent-[var(--c-primary-ink)]" data-testid="email-opt-in" @change="saveEmail" />
        <span>
          <span class="font-semibold">{{ $t('settings.emailOptIn') }}</span>
          <span class="block text-sm text-muted">{{ $t('settings.emailHint', { email: session.me?.email ?? '' }) }}</span>
        </span>
      </label>
      <form class="space-y-2" @submit.prevent="saveWebhook">
        <label class="block">
          <span class="field-label">{{ $t('settings.discord') }} <span class="font-normal text-muted">({{ $t('common.optional') }})</span></span>
          <input v-model="webhook" type="url" class="input" placeholder="https://discord.com/api/webhooks/…" />
          <span class="field-hint">{{ $t('settings.discordHint') }}</span>
        </label>
        <div class="flex flex-wrap gap-2">
          <button type="submit" class="btn btn-primary">{{ $t('common.save') }}</button>
          <button v-if="session.me?.discordWebhook" type="button" class="btn btn-secondary" @click="testWebhook">{{ $t('settings.discordTest') }}</button>
        </div>
      </form>
    </section>

    <section class="card space-y-3 p-6">
      <h2 class="h2">{{ $t('settings.appearance') }}</h2>
      <ThemeToggle />
    </section>

    <section class="card space-y-3 border-danger p-6">
      <h2 class="h2">{{ $t('settings.account') }}</h2>
      <p class="text-muted">{{ $t('settings.deleteHint') }}</p>
      <button type="button" class="btn btn-danger" @click="deleteAccount">{{ $t('settings.deleteAccount') }}</button>
    </section>
  </div>
</template>
