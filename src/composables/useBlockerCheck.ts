import { ref } from 'vue'
import { useSession } from '@/stores/session'

/**
 * Detects ad/tracker blockers that would stop recording uploads: a bait element that blockers hide,
 * plus a direct request to the storage host the recording goes to.
 */
export function useBlockerCheck() {
  const session = useSession()
  const blocked = ref(false)
  const checking = ref(false)

  async function baitHidden(): Promise<boolean> {
    const bait = document.createElement('div')
    bait.className = 'ad ads adsbox ad-banner ad-placement doubleclick sponsor-ad'
    bait.setAttribute('aria-hidden', 'true')
    bait.style.cssText = 'position:absolute;left:-9999px;top:-9999px;width:10px;height:10px;'
    document.body.appendChild(bait)
    await new Promise((r) => setTimeout(r, 150))
    const hidden = bait.offsetHeight === 0 || getComputedStyle(bait).display === 'none' || getComputedStyle(bait).visibility === 'hidden'
    bait.remove()
    return hidden
  }

  async function storageBlocked(): Promise<boolean> {
    const origin = session.config.storageOrigin
    if (!origin) return false
    try {
      await fetch(origin, { mode: 'no-cors', cache: 'no-store' })
      return false
    } catch {
      return true
    }
  }

  async function check() {
    checking.value = true
    try {
      const [a, b] = await Promise.all([baitHidden(), storageBlocked()])
      blocked.value = a || b
    } finally {
      checking.value = false
    }
  }

  return { blocked, checking, check }
}
