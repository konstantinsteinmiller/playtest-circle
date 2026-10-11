import { ref, watch } from 'vue'

export type ThemePref = 'dark' | 'light' | 'system'
const KEY = 'ptc-theme'

function read(): ThemePref {
  try {
    const v = localStorage.getItem(KEY)
    if (v === 'dark' || v === 'light' || v === 'system') return v
  } catch {
    /* storage blocked */
  }
  return 'dark'
}

const pref = ref<ThemePref>(read())
const media = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null

function apply() {
  const dark = pref.value === 'system' ? !!media?.matches : pref.value === 'dark'
  document.documentElement.dataset.theme = dark ? 'dark' : 'light'
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#0B0B10' : '#F7F7F2')
}

media?.addEventListener('change', () => pref.value === 'system' && apply())
watch(pref, (v) => {
  try {
    localStorage.setItem(KEY, v)
  } catch {
    /* storage blocked */
  }
  apply()
})

export function useTheme() {
  return { pref, apply }
}
