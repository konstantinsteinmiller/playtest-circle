<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

// A short pictogram "video" of the whole loop, drawn in SVG and animated with CSS.
// Code instead of an .mp4: crisp at any size, follows the theme, every caption goes through i18n.
const SCENES = [1, 2, 3, 4, 5] as const
const SCENE_MS = 6000

const scene = ref(0)
const elapsed = ref(0)
const playing = ref(false)
const ended = ref(false)
let last = 0
let raf = 0

function tick(t: number) {
  if (!playing.value) return
  elapsed.value += last ? t - last : 0
  last = t
  if (elapsed.value >= SCENE_MS) {
    if (scene.value === SCENES.length - 1) {
      elapsed.value = SCENE_MS
      playing.value = false
      ended.value = true
      return
    }
    scene.value++
    elapsed.value = 0
  }
  raf = requestAnimationFrame(tick)
}
function play() {
  if (ended.value) replay()
  playing.value = true
  last = 0
  raf = requestAnimationFrame(tick)
}
function pause() {
  playing.value = false
  cancelAnimationFrame(raf)
}
function replay() {
  ended.value = false
  scene.value = 0
  elapsed.value = 0
}
function goTo(i: number) {
  ended.value = false
  scene.value = i
  elapsed.value = 0
}

const progress = computed(() => ((scene.value + elapsed.value / SCENE_MS) / SCENES.length) * 100)

onMounted(() => {
  // Autoplay (silent anyway), except for people who asked for less motion: they press play.
  if (!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) play()
})
onBeforeUnmount(() => cancelAnimationFrame(raf))
</script>

<template>
  <figure class="card overflow-hidden" data-testid="onboarding-video" :aria-label="$t('video.title')">
    <div class="ov-stage relative aspect-video bg-surface-2" :class="{ 'ov-paused': !playing }">
      <svg :key="scene" viewBox="0 0 320 180" class="size-full" role="img" :aria-label="$t(`video.s${SCENES[scene]}Title`)">
        <!-- 1 · Test games, earn Credits -->
        <g v-if="scene === 0">
          <rect x="40" y="40" width="130" height="90" rx="8" class="ov-frame" />
          <circle cx="56" cy="52" r="4" class="ov-rec" />
          <g class="ov-pop" style="animation-delay: 0.2s">
            <rect x="72" y="72" width="66" height="40" rx="14" class="ov-ink" />
            <circle cx="88" cy="92" r="5" class="ov-bg" />
            <circle cx="120" cy="88" r="3.5" class="ov-bg" />
            <circle cx="128" cy="96" r="3.5" class="ov-bg" />
          </g>
          <g class="ov-pop" style="animation-delay: 1.4s">
            <rect x="200" y="50" width="80" height="20" rx="4" class="ov-line" />
            <rect x="200" y="78" width="80" height="20" rx="4" class="ov-line" />
            <path d="M206 60l4 4 8-8M206 88l4 4 8-8" class="ov-check" />
          </g>
          <g v-for="i in 3" :key="i" class="ov-coin-fly" :style="{ animationDelay: `${2.4 + i * 0.35}s` }">
            <circle cx="240" cy="140" r="11" class="ov-coin" />
            <text x="240" y="144.5" text-anchor="middle" class="ov-coin-text">◎</text>
          </g>
        </g>

        <!-- 2 · Add your game -->
        <g v-else-if="scene === 1">
          <rect x="95" y="25" width="130" height="130" rx="10" class="ov-frame ov-pop" />
          <g class="ov-pop" style="animation-delay: 0.6s">
            <rect x="107" y="37" width="106" height="60" rx="6" class="ov-primary" />
            <path d="M115 90l22-26 16 18 10-10 24 18z" class="ov-bg" />
            <circle cx="195" cy="52" r="7" class="ov-bg" />
          </g>
          <rect x="107" y="106" width="80" height="9" rx="4" class="ov-ink ov-grow" style="animation-delay: 1.4s" />
          <rect x="107" y="122" width="56" height="7" rx="3" class="ov-muted ov-grow" style="animation-delay: 1.9s" />
          <g class="ov-pop" style="animation-delay: 2.6s">
            <rect x="107" y="136" width="52" height="12" rx="6" class="ov-info" />
            <path d="M115 142h10m-3-3 3 3-3 3" class="ov-stroke-bg" />
          </g>
          <g class="ov-pop" style="animation-delay: 3.4s">
            <circle cx="250" cy="60" r="18" class="ov-accent" />
            <text x="250" y="66" text-anchor="middle" class="ov-big-text">5′</text>
          </g>
        </g>

        <!-- 3 · Launch a campaign (Credits go into escrow) -->
        <g v-else-if="scene === 2">
          <g v-for="i in 3" :key="i" class="ov-pop" :style="{ animationDelay: `${0.2 + i * 0.4}s` }">
            <rect x="30" :y="30 + i * 30" width="110" height="20" rx="4" class="ov-line" />
            <path :d="`M36 ${40 + i * 30}l4 4 8-8`" class="ov-check" />
            <rect x="56" :y="37 + i * 30" :width="60 - i * 10" height="6" rx="3" class="ov-muted" />
          </g>
          <g class="ov-pop" style="animation-delay: 1.8s">
            <rect x="200" y="80" width="70" height="60" rx="8" class="ov-ink" />
            <path d="M215 80v-12a20 20 0 0 1 40 0v12" class="ov-stroke-ink" />
            <circle cx="235" cy="108" r="7" class="ov-bg" />
            <rect x="232" y="108" width="6" height="16" rx="2" class="ov-bg" />
          </g>
          <g v-for="i in 3" :key="`c${i}`" class="ov-coin-drop" :style="{ animationDelay: `${2.6 + i * 0.4}s` }">
            <circle cx="235" cy="30" r="10" class="ov-coin" />
            <text x="235" y="34" text-anchor="middle" class="ov-coin-text">◎</text>
          </g>
        </g>

        <!-- 4 · Watch and learn -->
        <g v-else-if="scene === 3">
          <rect x="40" y="30" width="170" height="100" rx="8" class="ov-ink ov-pop" />
          <path d="M115 62v36l30-18z" class="ov-primary ov-pop" style="animation-delay: 0.6s" />
          <rect x="40" y="140" width="170" height="6" rx="3" class="ov-line" />
          <rect x="40" y="140" width="170" height="6" rx="3" class="ov-primary ov-scrub" style="animation-delay: 1s" />
          <g v-for="(x, i) in [80, 130, 175]" :key="x" class="ov-pop" :style="{ animationDelay: `${1.4 + i * 0.4}s` }">
            <path :d="`M${x} 152l-5 8h10z`" class="ov-accent" />
          </g>
          <g class="ov-pop" style="animation-delay: 3.4s">
            <circle cx="260" cy="80" r="26" class="ov-primary" />
            <text x="260" y="90" text-anchor="middle" class="ov-emoji">👍</text>
          </g>
        </g>

        <!-- 5 · The circle -->
        <g v-else>
          <g class="ov-spin">
            <path d="M160 40a50 50 0 0 1 48 36" class="ov-arrow ov-arrow-a" />
            <path d="M203 72l5 8 6-9" class="ov-arrow ov-arrow-a" />
            <path d="M160 140a50 50 0 0 1-48-36" class="ov-arrow ov-arrow-b" />
            <path d="M117 108l-5-8-6 9" class="ov-arrow ov-arrow-b" />
          </g>
          <path d="M150 74v32l26-16z" class="ov-primary ov-pop" style="animation-delay: 0.5s" />
          <g class="ov-pop" style="animation-delay: 1.4s">
            <circle cx="60" cy="90" r="20" class="ov-info" />
            <text x="60" y="97" text-anchor="middle" class="ov-emoji-sm">🎮</text>
          </g>
          <g class="ov-pop" style="animation-delay: 2s">
            <circle cx="260" cy="90" r="20" class="ov-accent" />
            <text x="260" y="97" text-anchor="middle" class="ov-emoji-sm">🛠️</text>
          </g>
        </g>
      </svg>
      <div class="absolute inset-x-0 bottom-0 h-1 bg-line/40">
        <div class="h-full bg-primary" :style="{ width: `${progress}%` }" />
      </div>
    </div>

    <figcaption class="space-y-3 p-4 sm:p-5">
      <div aria-live="polite">
        <p class="h3" data-testid="video-title">{{ $t(`video.s${SCENES[scene]}Title`) }}</p>
        <p class="text-muted">{{ $t(`video.s${SCENES[scene]}Body`) }}</p>
      </div>
      <div class="flex flex-wrap items-center gap-3">
        <button v-if="playing" type="button" class="btn btn-secondary min-h-10 py-1" data-testid="video-pause" @click="pause">❚❚ {{ $t('video.pause') }}</button>
        <button v-else-if="ended" type="button" class="btn btn-primary min-h-10 py-1" data-testid="video-replay" @click="play">↻ {{ $t('video.replay') }}</button>
        <button v-else type="button" class="btn btn-primary min-h-10 py-1" data-testid="video-play" @click="play">▶ {{ $t('video.play') }}</button>
        <div class="flex gap-1">
          <button
            v-for="(n, i) in SCENES"
            :key="n"
            type="button"
            class="grid size-10 place-items-center"
            :aria-label="$t('video.scene', { n, title: $t(`video.s${n}Title`) })"
            :aria-current="i === scene ? 'step' : undefined"
            @click="goTo(i)"
          >
            <span class="block size-3 rounded-full" :class="i === scene ? 'bg-primary-ink' : 'bg-line'" />
          </button>
        </div>
      </div>
    </figcaption>
  </figure>
</template>

<style scoped>
.ov-frame { fill: var(--c-surface); stroke: var(--c-line); stroke-width: 2; }
.ov-line { fill: var(--c-surface); stroke: var(--c-line); stroke-width: 1.5; }
.ov-ink { fill: var(--c-ink); }
.ov-bg { fill: var(--c-surface-2); }
.ov-muted { fill: var(--c-line); }
.ov-primary { fill: var(--c-primary); }
.ov-accent { fill: var(--c-accent); }
.ov-info { fill: var(--c-info-ink); }
.ov-rec { fill: #ff3b3b; animation: ov-blink 1s steps(2) infinite; }
.ov-check { fill: none; stroke: var(--c-primary-ink); stroke-width: 2.5; stroke-linecap: round; stroke-linejoin: round; }
.ov-stroke-bg { fill: none; stroke: var(--c-surface-2); stroke-width: 2; stroke-linecap: round; }
.ov-stroke-ink { fill: none; stroke: var(--c-ink); stroke-width: 7; }
.ov-coin { fill: var(--c-primary); stroke: #0b0b10; stroke-width: 1.5; }
.ov-coin-text { font: 700 12px system-ui, sans-serif; fill: #0b0b10; }
.ov-big-text { font: 700 16px system-ui, sans-serif; fill: #0b0b10; }
.ov-emoji { font-size: 26px; }
.ov-emoji-sm { font-size: 18px; }
.ov-arrow { fill: none; stroke-width: 7; stroke-linecap: round; stroke-linejoin: round; }
.ov-arrow-a { stroke: var(--c-primary-ink); }
.ov-arrow-b { stroke: var(--c-accent-ink); }

.ov-pop, .ov-grow, .ov-coin-fly, .ov-coin-drop, .ov-scrub { animation-fill-mode: both; transform-box: fill-box; }
.ov-pop { transform-origin: center; animation: ov-pop 0.5s cubic-bezier(0.3, 1.6, 0.5, 1) both; }
.ov-grow { transform-origin: left; animation: ov-grow 0.6s ease-out both; }
.ov-scrub { transform-origin: left; animation: ov-grow 3.5s linear both; }
.ov-coin-fly { animation: ov-fly 0.9s ease-in both; }
.ov-coin-drop { animation: ov-drop 0.8s ease-in both; }
.ov-spin { transform-origin: 160px 90px; animation: ov-spin 6s linear infinite; }

.ov-paused * { animation-play-state: paused !important; }

@keyframes ov-pop { from { opacity: 0; transform: scale(0.4); } to { opacity: 1; transform: scale(1); } }
@keyframes ov-grow { from { transform: scaleX(0); } to { transform: scaleX(1); } }
@keyframes ov-fly { from { opacity: 0; transform: translate(-150px, -40px); } 30% { opacity: 1; } to { opacity: 1; transform: translate(0, 0); } }
@keyframes ov-drop { from { opacity: 0; transform: translateY(-10px); } 30% { opacity: 1; } to { opacity: 0; transform: translateY(70px); } }
@keyframes ov-spin { to { transform: rotate(360deg); } }
@keyframes ov-blink { 50% { opacity: 0.2; } }

@media (prefers-reduced-motion: reduce) {
  .ov-stage * { animation-duration: 0.01ms !important; animation-delay: 0s !important; animation-iteration-count: 1 !important; }
}
</style>
