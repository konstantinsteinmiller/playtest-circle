<script setup lang="ts">
import { ref } from 'vue'
import { api, putToUrl } from '@/lib/api'
import { toWebp } from '@/lib/image'

const props = defineProps<{ kind: 'image' | 'clip'; label: string; hint?: string; multiple?: boolean; maxBytes: number }>()
const emit = defineEmits<{ uploaded: [key: string, url: string] }>()
const busy = ref(false)
const error = ref('')
const input = ref<HTMLInputElement>()

async function upload(file: File) {
  const blob = props.kind === 'image' ? await toWebp(file) : file
  const type = props.kind === 'image' ? 'image/webp' : file.type
  if (blob.size > props.maxBytes) throw new Error('too_large')
  const r = await api<{ key: string; putUrl: string; url: string }>('/games/media-upload', {
    method: 'POST',
    json: { kind: props.kind, contentType: type, size: blob.size },
  })
  await putToUrl(r.putUrl, blob, type)
  emit('uploaded', r.key, r.url)
}

async function onChange(e: Event) {
  const files = [...((e.target as HTMLInputElement).files ?? [])]
  if (!files.length) return
  busy.value = true
  error.value = ''
  try {
    for (const f of files) await upload(f)
  } catch {
    error.value = 'failed'
  } finally {
    busy.value = false
    if (input.value) input.value.value = ''
  }
}
</script>

<template>
  <div>
    <label class="btn btn-secondary cursor-pointer" :class="busy && 'pointer-events-none opacity-60'">
      <input
        ref="input"
        type="file"
        class="sr-only"
        :accept="kind === 'image' ? 'image/png,image/jpeg,image/webp' : 'video/mp4,video/webm'"
        :multiple="multiple"
        @change="onChange"
      />
      <span aria-hidden="true">⬆</span>
      {{ busy ? $t('game.uploading') : label }}
    </label>
    <p v-if="hint" class="field-hint">{{ hint }}</p>
    <p v-if="error" class="mt-1 text-sm font-semibold text-danger-ink" role="alert">{{ $t('game.uploadFailed') }}</p>
  </div>
</template>
