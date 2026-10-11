import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'
import { signIn } from './helpers'

const PAGES = ['/', '/how-it-works', '/browse', '/studio', '/studio/games/new', '/studio/campaigns/new', '/wallet', '/settings', '/privacy']

for (const theme of ['dark', 'light'] as const) {
  test(`no serious accessibility violations — ${theme} theme`, async ({ page }) => {
    await signIn(page, `a11y-${theme}@example.com`, 'A11y')
    await page.addInitScript((t) => localStorage.setItem('ptc-theme', t), theme)
    for (const path of PAGES) {
      await page.goto(path)
      await page.waitForLoadState('networkidle')
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
      const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()
      const serious = result.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')
      expect(serious.map((v) => `${path}: ${v.id} — ${v.nodes[0]?.target}`)).toEqual([])
    }
  })
}
