<script setup lang="ts">
import GoogleIcon from '@/components/GoogleIcon.vue'
import { onClickOutside } from '@vueuse/core'
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'
import { useSession } from '@/stores/session'
import AppLogo from './AppLogo.vue'
import NotificationBell from './NotificationBell.vue'
import ThemeToggle from './ThemeToggle.vue'

const session = useSession()
const router = useRouter()
const route = useRoute()
const { t } = useI18n()
const menuOpen = ref(false)
const accountOpen = ref(false)
const account = ref<HTMLElement>()
onClickOutside(account, () => (accountOpen.value = false))

async function signOut() {
  // A guest account only lives in this browser's session: signing out loses it.
  if (session.me?.guest && !window.confirm(t('nav.guestSignOutConfirm'))) return
  await session.logout()
  accountOpen.value = false
  router.push('/')
}

// Browsing needs no account; the studio needs Google, the wallet any account (guests earn Credits too).
const links = computed(() => [
  { to: '/browse', key: 'nav.browse' },
  { to: '/games', key: 'nav.games' },
  ...(session.member ? [{ to: '/studio', key: 'nav.studio' }] : []),
  ...(session.signedIn ? [{ to: '/wallet', key: 'nav.wallet' }] : []),
  { to: '/how-it-works', key: 'nav.howItWorks' },
])
</script>

<template>
  <header class="sticky top-0 z-20 border-b-2 border-line bg-canvas/95 backdrop-blur">
    <a href="#main" class="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 btn-primary btn">{{ $t('nav.skipToContent') }}</a>
    <div class="mx-auto flex h-16 max-w-7xl items-center gap-2 px-4 sm:gap-4">
      <RouterLink :to="session.member ? '/browse' : '/'" class="rounded-lg">
        <AppLogo :size="36" responsive />
        <span class="sr-only sm:hidden">{{ $t('brand.name') }}</span>
      </RouterLink>

      <nav class="ml-6 hidden items-center gap-1 lg:flex">
        <RouterLink
          v-for="l in links"
          :key="l.to"
          :to="l.to"
          class="rounded-lg px-3 py-2 font-semibold hover:bg-surface-2"
          active-class="bg-surface-2 text-primary-ink"
          >{{ $t(l.key) }}</RouterLink
        >
      </nav>

      <div class="ml-auto flex items-center gap-2">
        <div class="hidden sm:block"><ThemeToggle /></div>
        <template v-if="session.me">
          <RouterLink to="/wallet" class="pill-credit" :aria-label="session.me.reserved ? $t('nav.balanceReserved', { n: session.me.credits, r: session.me.reserved }) : $t('nav.balance', { n: session.me.credits })">
            <span aria-hidden="true">◎</span>{{ session.me.credits }}
            <span v-if="session.me.reserved" class="hidden text-xs font-semibold opacity-80 md:inline" data-testid="reserved-pill">
              {{ $t('nav.reservedShort', { n: session.me.reserved }) }}
            </span>
          </RouterLink>
          <NotificationBell />
          <div ref="account" class="relative">
            <button
              type="button"
              class="grid size-11 place-items-center overflow-hidden rounded-full border-2 border-line"
              :aria-label="$t('nav.account')"
              :aria-expanded="accountOpen"
              @click="accountOpen = !accountOpen"
            >
              <img v-if="session.me.avatarUrl" :src="session.me.avatarUrl" alt="" class="size-full object-cover" referrerpolicy="no-referrer" />
              <span v-else class="font-display font-bold">{{ session.me.name.slice(0, 1).toUpperCase() }}</span>
            </button>
            <div v-if="accountOpen" class="card absolute right-0 z-30 mt-2 w-56 p-2 shadow-2xl" @click="accountOpen = false">
              <p v-if="session.me.guest" class="px-3 py-2 text-sm text-muted">{{ $t('nav.guestAccount') }}</p>
              <p v-else class="truncate px-3 py-2 text-sm text-muted">{{ session.me.email }}</p>
              <a v-if="session.me.guest" :href="session.loginUrl(route.fullPath)" class="flex items-center gap-2 rounded-lg px-3 py-2 font-semibold hover:bg-surface-2" data-testid="guest-link-google">
                <GoogleIcon />{{ $t('nav.guestKeep') }}
              </a>
              <RouterLink :to="`/u/${session.me.id}`" class="block rounded-lg px-3 py-2 hover:bg-surface-2">{{ session.me.name }}</RouterLink>
              <RouterLink to="/settings" class="block rounded-lg px-3 py-2 hover:bg-surface-2">{{ $t('nav.settings') }}</RouterLink>
              <RouterLink v-if="session.me.role === 'admin'" to="/admin" class="block rounded-lg px-3 py-2 hover:bg-surface-2">{{
                $t('nav.admin')
              }}</RouterLink>
              <button type="button" class="block w-full rounded-lg px-3 py-2 text-left hover:bg-surface-2" @click="signOut">
                {{ $t('nav.signOut') }}
              </button>
            </div>
          </div>
        </template>
        <a v-else :href="session.loginUrl(route.fullPath)" class="btn btn-primary whitespace-nowrap"><GoogleIcon /><span class="sm:hidden">{{ $t('nav.signInShort') }}</span><span class="hidden sm:inline">{{ $t('nav.signIn') }}</span></a>
        <button
          type="button"
          class="grid size-11 place-items-center rounded-xl hover:bg-surface-2 lg:hidden"
          :aria-label="$t('nav.menu')"
          :aria-expanded="menuOpen"
          @click="menuOpen = !menuOpen"
        >
          <svg viewBox="0 0 24 24" class="size-6" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true">
            <path d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>
      </div>
    </div>
    <nav v-if="menuOpen" class="border-t-2 border-line px-4 py-2 lg:hidden" @click="menuOpen = false">
      <RouterLink v-for="l in links" :key="l.to" :to="l.to" class="block rounded-lg px-3 py-3 font-semibold hover:bg-surface-2">{{
        $t(l.key)
      }}</RouterLink>
      <div class="mt-2 sm:hidden"><ThemeToggle /></div>
    </nav>
  </header>
</template>
