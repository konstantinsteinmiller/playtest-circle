import { ref } from 'vue'

/**
 * Detects ad/tracker blockers, which can stop recording uploads, with a bait element that blockers hide.
 * (Probing the storage host directly logs a 403 in the console, which looks like a failure to testers.)
 */
export function useBlockerCheck() {
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

  async function check() {
    checking.value = true
    try {
      blocked.value = await baitHidden()
    } finally {
      checking.value = false
    }
  }

  return { blocked, checking, check }
}
