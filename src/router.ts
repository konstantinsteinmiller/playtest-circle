import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router'
import { useSession } from './stores/session'

const routes: RouteRecordRaw[] = [
  { path: '/', name: 'landing', component: () => import('./pages/LandingPage.vue'), meta: { public: true } },
  { path: '/how-it-works', name: 'tutorial', component: () => import('./pages/TutorialPage.vue'), meta: { public: true } },
  { path: '/browse', name: 'browse', component: () => import('./pages/BrowsePage.vue'), meta: { public: true, app: true } },
  { path: '/games', name: 'games', component: () => import('./pages/GamesPage.vue'), meta: { public: true, app: true } },
  { path: '/g/:id', name: 'game', component: () => import('./pages/GamePage.vue'), meta: { public: true, app: true } },
  { path: '/c/:id', name: 'campaign', component: () => import('./pages/CampaignPage.vue'), meta: { public: true, app: true } },
  { path: '/play/:id', name: 'play', component: () => import('./pages/PlayPage.vue') },
  { path: '/studio', name: 'studio', component: () => import('./pages/studio/StudioPage.vue') },
  { path: '/studio/games/new', name: 'game-new', component: () => import('./pages/studio/GameEditorPage.vue') },
  { path: '/studio/games/:id/edit', name: 'game-edit', component: () => import('./pages/studio/GameEditorPage.vue') },
  { path: '/studio/campaigns/new', name: 'campaign-new', component: () => import('./pages/studio/CampaignWizardPage.vue') },
  { path: '/studio/campaigns/:id', name: 'campaign-results', component: () => import('./pages/studio/CampaignResultsPage.vue') },
  { path: '/studio/playtests/:id', name: 'playtest-review', component: () => import('./pages/studio/PlaytestReviewPage.vue') },
  { path: '/wallet', name: 'wallet', component: () => import('./pages/WalletPage.vue') },
  { path: '/settings', name: 'settings', component: () => import('./pages/SettingsPage.vue') },
  { path: '/u/:id', name: 'profile', component: () => import('./pages/ProfilePage.vue'), meta: { public: true } },
  { path: '/admin', name: 'admin', component: () => import('./pages/AdminPage.vue'), meta: { public: true } },
  { path: '/privacy', name: 'privacy', component: () => import('./pages/legal/PrivacyPage.vue'), meta: { public: true } },
  { path: '/terms', name: 'terms', component: () => import('./pages/legal/TermsPage.vue'), meta: { public: true } },
  { path: '/imprint', name: 'imprint', component: () => import('./pages/legal/ImprintPage.vue'), meta: { public: true } },
  { path: '/:pathMatch(.*)*', name: 'not-found', component: () => import('./pages/NotFoundPage.vue'), meta: { public: true } },
]

export const router = createRouter({
  history: createWebHistory(),
  routes,
  scrollBehavior: (_to, _from, saved) => saved ?? { top: 0 },
})

router.beforeEach(async (to) => {
  const session = useSession()
  await session.ensureLoaded().catch(() => {})
  const me = session.me
  // First visit after sign-up: show the short tutorial once.
  if (me && !me.onboarded && (to.meta.app || !to.meta.public)) return { name: 'tutorial' }
  if (to.meta.public) return true
  if (!me) return { name: 'landing', query: { returnTo: to.fullPath } }
  return true
})

// After a deploy, an open tab still points at old chunk hashes that no longer exist.
// Load the target page fresh instead of failing (form drafts survive the reload).
router.onError((err, to) => {
  if (/dynamically imported module|Importing a module script failed|module script/i.test(String(err?.message))) {
    const key = 'ptc-chunk-reload'
    try {
      if (sessionStorage.getItem(key) === to.fullPath) return
      sessionStorage.setItem(key, to.fullPath)
    } catch {}
    window.location.assign(to.fullPath)
  }
})
