<script setup lang="ts">
import { ref } from 'vue'
import type { CampaignCard } from '@shared/types'

const props = defineProps<{ campaign: CampaignCard; layout: 'grid' | 'list' }>()
const video = ref<HTMLVideoElement>()
const previewing = ref(false)

function startPreview() {
  if (!props.campaign.game.hoverClipUrl || !video.value) return
  previewing.value = true
  video.value.currentTime = 0
  video.value.play().catch(() => (previewing.value = false))
}
function stopPreview() {
  previewing.value = false
  video.value?.pause()
}
</script>

<template>
  <article
    class="card group relative overflow-hidden transition hover:-translate-y-0.5 hover:border-primary-ink focus-within:border-primary-ink"
    :class="layout === 'list' ? 'flex flex-col sm:flex-row' : 'flex flex-col'"
    @mouseenter="startPreview"
    @mouseleave="stopPreview"
    @focusin="startPreview"
    @focusout="stopPreview"
  >
    <div class="relative aspect-video shrink-0 overflow-hidden bg-surface-2" :class="layout === 'list' ? 'sm:w-72' : 'w-full'">
      <img
        v-if="campaign.game.coverUrl"
        :src="campaign.game.coverUrl"
        :alt="$t('campaign.coverAlt', { title: campaign.game.title })"
        class="size-full object-cover"
        loading="lazy"
      />
      <div v-else class="grid size-full place-items-center font-display text-4xl font-bold text-muted" aria-hidden="true">
        {{ campaign.game.title.slice(0, 2).toUpperCase() }}
      </div>
      <video
        v-if="campaign.game.hoverClipUrl"
        ref="video"
        :src="campaign.game.hoverClipUrl"
        muted
        loop
        playsinline
        preload="none"
        aria-hidden="true"
        class="absolute inset-0 size-full object-cover transition-opacity"
        :class="previewing ? 'opacity-100' : 'opacity-0'"
      />
      <span class="pill-credit absolute top-3 right-3 shadow-lg">
        <span aria-hidden="true">◎</span>{{ $t('common.credits', campaign.price) }}
      </span>
    </div>
    <div class="flex flex-1 flex-col gap-3 p-4">
      <div>
        <h3 class="h3">
          <RouterLink :to="`/c/${campaign.id}`" class="after:absolute after:inset-0 focus:outline-none">{{ campaign.game.title }}</RouterLink>
        </h3>
        <p class="text-sm text-muted">{{ $t('browse.by', { name: campaign.owner.name }) }} · {{ campaign.buildLabel }}</p>
      </div>
      <p class="line-clamp-2">{{ campaign.game.pitch }}</p>
      <div class="mt-auto flex flex-wrap gap-2">
        <span class="chip border-info-ink text-info-ink">⏱ {{ $t(`presets.playtime.${campaign.playtimePreset}`) }}</span>
        <span class="chip">{{ $t('browse.slotsLeft', campaign.slotsLeft) }}</span>
        <span class="chip">{{ $t(`hosts.${campaign.game.host}`) }}</span>
        <span v-for="tag in campaign.game.tags.slice(0, 3)" :key="tag" class="chip text-muted">#{{ tag }}</span>
      </div>
    </div>
  </article>
</template>
