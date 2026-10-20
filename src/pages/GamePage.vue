<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute } from 'vue-router'
import { MAX_COMMENT_LENGTH } from '@shared/rules'
import type { GamePage } from '@shared/types'
import { useErrorText } from '@/composables/useErrorText'
import { api } from '@/lib/api'
import { embedUrl } from '@/lib/embed'
import { useSession } from '@/stores/session'

const route = useRoute()
const session = useSession()
const errorText = useErrorText()
const { t } = useI18n()
const id = String(route.params.id)

const page = ref<GamePage | null>(null)
const error = ref('')
const comment = ref('')
const posting = ref(false)
const commentError = ref('')
const played = ref(false)

async function load() {
  try {
    page.value = await api<GamePage>(`/games/${id}/page`)
  } catch (e) {
    error.value = errorText(e)
  }
}
onMounted(async () => {
  await load()
  // A link from a comment email lands on that comment.
  if (route.hash.startsWith('#comment-')) {
    await nextTick()
    document.getElementById(route.hash.slice(1))?.scrollIntoView({ block: 'center' })
  }
})

const game = computed(() => page.value?.game)
const trailer = computed(() => embedUrl(game.value?.trailerUrl ?? null))

/** Free play: no recording, no questionnaire, no Credits — just the game. */
function play() {
  if (!game.value) return
  window.open(game.value.playUrl, '_blank', 'noopener')
  played.value = true
}

async function postComment() {
  const text = comment.value.trim()
  if (text.length < 2) return
  posting.value = true
  commentError.value = ''
  try {
    // Commenting needs an account: a visitor without one gets a guest account here.
    await session.ensureGuest()
    await api(`/games/${id}/comments`, { method: 'POST', json: { text } })
    comment.value = ''
    await load()
  } catch (e) {
    commentError.value = errorText(e)
  } finally {
    posting.value = false
  }
}

async function removeComment(commentId: string) {
  if (!window.confirm(t('gamePage.deleteConfirm'))) return
  await api(`/games/${id}/comments/${commentId}`, { method: 'DELETE' }).catch((e) => (commentError.value = errorText(e)))
  await load()
}

const when = (ts: number) => new Date(ts).toLocaleString()
</script>

<template>
  <p v-if="!page && error" class="card p-6 font-semibold text-danger-ink" role="alert">{{ error }}</p>
  <p v-else-if="!page" class="text-muted">{{ $t('common.loading') }}</p>
  <div v-else-if="game" class="grid gap-8 lg:grid-cols-[1fr_380px]">
    <div class="min-w-0 space-y-8">
      <header class="space-y-3">
        <p class="text-muted">
          <RouterLink :to="`/u/${page.owner.id}`" class="underline">{{ $t('browse.by', { name: page.owner.name }) }}</RouterLink>
          · {{ $t(`hosts.${game.host}`) }}
        </p>
        <h1 class="h1">{{ game.title }}</h1>
        <p class="text-lg">{{ game.pitch }}</p>
        <div class="flex flex-wrap gap-2">
          <span v-for="tag in game.tags" :key="tag" class="chip">#{{ tag }}</span>
        </div>
      </header>

      <div v-if="trailer || game.coverUrl" class="card aspect-video overflow-hidden">
        <iframe
          v-if="trailer"
          :src="trailer"
          :title="$t('campaign.trailer')"
          class="size-full"
          allow="accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture; fullscreen"
          allowfullscreen
          loading="lazy"
        />
        <img v-else :src="game.coverUrl!" :alt="$t('campaign.coverAlt', { title: game.title })" class="size-full object-cover" />
      </div>

      <section v-if="game.screenshots.length" class="space-y-3">
        <h2 class="h2">{{ $t('campaign.screenshots') }}</h2>
        <div class="grid grid-cols-2 gap-3 md:grid-cols-3">
          <img
            v-for="(s, i) in game.screenshots"
            :key="s"
            :src="s"
            :alt="$t('campaign.screenshotAlt', { n: i + 1, title: game.title })"
            class="card aspect-video w-full object-cover"
            loading="lazy"
          />
        </div>
      </section>

      <section v-if="game.description" class="space-y-3">
        <h2 class="h2">{{ $t('campaign.about') }}</h2>
        <p class="whitespace-pre-line">{{ game.description }}</p>
      </section>

      <section class="space-y-4" data-testid="comments">
        <h2 class="h2">{{ $t('gamePage.comments', page.comments.length) }}</h2>
        <form class="card space-y-3 p-5" @submit.prevent="postComment">
          <label class="block">
            <span class="field-label">{{ $t('gamePage.commentLabel') }}</span>
            <textarea v-model="comment" class="input min-h-24" :maxlength="MAX_COMMENT_LENGTH" :placeholder="$t('gamePage.commentPlaceholder')" data-testid="comment-text" />
          </label>
          <p class="text-sm text-muted">
            {{ session.me ? $t('gamePage.commentingAs', { name: session.me.name }) : $t('gamePage.commentAsGuest') }}
          </p>
          <button type="submit" class="btn btn-primary" :disabled="posting || comment.trim().length < 2" data-testid="post-comment">{{ $t('gamePage.post') }}</button>
          <p v-if="commentError" class="font-semibold text-danger-ink" role="alert">{{ commentError }}</p>
        </form>
        <p v-if="!page.comments.length" class="text-muted">{{ $t('gamePage.noComments') }}</p>
        <ul class="space-y-3">
          <li
            v-for="c in page.comments"
            :id="`comment-${c.id}`"
            :key="c.id"
            class="card scroll-mt-24 space-y-2 p-4"
            :class="{ 'border-2 border-primary': route.hash === `#comment-${c.id}` }"
            data-testid="comment"
          >
            <div class="flex flex-wrap items-center justify-between gap-2 text-sm">
              <p>
                <RouterLink :to="`/u/${c.author.id}`" class="font-semibold underline">{{ c.author.name }}</RouterLink>
                <span v-if="c.author.guest" class="chip ml-2 text-xs">{{ $t('gamePage.guest') }}</span>
                <span v-if="c.author.id === page.owner.id" class="chip ml-2 text-xs text-primary-ink">{{ $t('gamePage.dev') }}</span>
                <span class="ml-2 text-muted">{{ when(c.createdAt) }}</span>
              </p>
              <button v-if="c.canDelete" type="button" class="btn btn-ghost min-h-9 py-1 text-sm" @click="removeComment(c.id)">{{ $t('common.delete') }}</button>
            </div>
            <p class="whitespace-pre-line">{{ c.text }}</p>
          </li>
        </ul>
      </section>
    </div>

    <aside class="space-y-4 lg:sticky lg:top-24 lg:self-start">
      <div class="card space-y-4 p-6">
        <h2 class="h3">{{ $t('gamePage.freePlayTitle') }}</h2>
        <p class="text-muted">{{ $t('gamePage.freePlayBody') }}</p>
        <button type="button" class="btn btn-secondary w-full text-lg" data-testid="free-play" @click="play">
          ↗ {{ played ? $t('gamePage.playedAgain') : $t('gamePage.play') }}
        </button>
        <div v-if="game.accessNotes">
          <h3 class="font-semibold">{{ $t('campaign.accessNotes') }}</h3>
          <p class="mt-1 whitespace-pre-line text-muted">{{ game.accessNotes }}</p>
        </div>
      </div>
      <div class="card space-y-3 p-6" data-testid="game-campaigns">
        <h2 class="h3">{{ $t('gamePage.paidTitle') }}</h2>
        <p v-if="!page.campaigns.length" class="text-muted">{{ $t('gamePage.noPaid') }}</p>
        <RouterLink
          v-for="c in page.campaigns"
          :key="c.id"
          :to="`/c/${c.id}`"
          class="flex items-center justify-between gap-3 rounded-xl border-2 border-line p-3 hover:border-primary-ink"
        >
          <span>
            <span class="block font-semibold">{{ c.buildLabel }}</span>
            <span class="block text-sm text-muted">{{ $t(`presets.playtime.${c.playtimePreset}`) }} · {{ $t('browse.slotsLeft', c.slotsLeft) }}</span>
          </span>
          <span class="pill-credit">◎ {{ c.price }}</span>
        </RouterLink>
      </div>
    </aside>
  </div>
</template>
