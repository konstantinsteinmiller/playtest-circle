<script setup lang="ts">
import { computed, ref } from 'vue'
import { api, putToUrl } from '@/lib/api'
import { toWebp } from '@/lib/image'

const props = defineProps<{ kind: 'image' | 'clip'; label: string; hint?: string; multiple?: boolean; maxBytes: number }>()
const emit = defineEmits<{ uploaded: [key: string, url: string] }>()
const busy = ref(false)
const dragging = ref(false)
const error = ref<'' | 'failed' | 'wrongType' | 'tooLarge'>('')
const input = ref<HTMLInputElement>()

// Hover clips must play inline in every browser, so only MP4 (MPEG-4) is accepted.
const ALLOWED = {
  image: { exts: ['.webp', '.png', '.jpeg', '.jpg'], mimes: ['image/webp', 'image/png', 'image/jpeg'] },
  clip: { exts: ['.mp4', '.m4v'], mimes: ['video/mp4'] },
}
const allowed = computed(() => ALLOWED[props.kind])
const accept = computed(() => [...allowed.value.exts, ...allowed.value.mimes].join(','))

function isAllowed(f: File) {
  const name = f.name.toLowerCase()
  return allowed.value.exts.some((e) => name.endsWith(e)) && (!f.type || allowed.value.mimes.includes(f.type))
}

class UploadError extends Error {}

async function upload(file: File) {
  const blob = props.kind === 'image' ? await toWebp(file) : file
  const type = props.kind === 'image' ? 'image/webp' : 'video/mp4'
  if (blob.size > props.maxBytes) throw new UploadError('tooLarge')
  const r = await api<{ key: string; putUrl: string; url: string }>('/games/media-upload', {
    method: 'POST',
    json: { kind: props.kind, contentType: type, size: blob.size },
  })
  await putToUrl(r.putUrl, blob, type)
  emit('uploaded', r.key, r.url)
}

async function handle(list: FileList | null | undefined) {
  let files = [...(list ?? [])]
  if (!props.multiple) files = files.slice(0, 1)
  if (!files.length || busy.value) return
  error.value = ''
  if (files.some((f) => !isAllowed(f))) {
    error.value = 'wrongType'
    files = files.filter(isAllowed)
    if (!files.length) return
  }
  busy.value = true
  try {
    for (const f of files) await upload(f)
  } catch (e) {
    error.value = e instanceof UploadError ? 'tooLarge' : 'failed'
  } finally {
    busy.value = false
    if (input.value) input.value.value = ''
  }
}

function onDrop(e: DragEvent) {
  dragging.value = false
  handle(e.dataTransfer?.files)
}
</script>

<template>
  <div>
    <label
      class="flex cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed p-5 text-center transition-colors focus-within:outline focus-within:outline-2 focus-within:outline-primary"
      :class="[dragging ? 'border-primary bg-surface-2' : 'border-line hover:border-ink', busy && 'pointer-events-none opacity-60']"
      :data-testid="`drop-${kind}`"
      @dragenter.prevent="dragging = true"
      @dragover.prevent="dragging = true"
      @dragleave.prevent="dragging = false"
      @drop.prevent="onDrop"
    >
      <input ref="input" type="file" class="sr-only" :accept="accept" :multiple="multiple" @change="handle(($event.target as HTMLInputElement).files)" />
      <span aria-hidden="true" class="text-2xl">⬆</span>
      <span class="font-semibold">{{ busy ? $t('game.uploading') : label }}</span>
      <span class="text-sm text-muted">
        {{ dragging ? $t('game.dropActive') : multiple ? $t('game.dropHereMany') : $t('game.dropHere') }} · {{ allowed.exts.join(', ') }}
      </span>
    </label>
    <p v-if="hint" class="field-hint">{{ hint }}</p>
    <p v-if="error" class="mt-1 text-sm font-semibold text-danger-ink" role="alert">
      {{ error === 'wrongType' ? $t('game.wrongType', { types: allowed.exts.join(', ') }) : error === 'tooLarge' ? $t('game.tooLarge') : $t('game.uploadFailed') }}
    </p>
  </div>
</template>
