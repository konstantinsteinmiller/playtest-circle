import { expect, test } from '@playwright/test'
import { signIn } from './helpers'

test('cheat grants Credits with Ctrl+Shift+K and they are clawed back with a toast', async ({ page }) => {
  await signIn(page, `cheater${Date.now()}@example.com`, 'Cheaty')
  await page.goto('/wallet')
  await expect(page.getByTestId('balance')).toBeVisible()
  await page.keyboard.press('Control+Shift+K') // not enabled yet
  await page.waitForTimeout(500)
  await expect(page.getByTestId('balance')).toContainText('10')

  await page.goto('/wallet?cheat=true')
  await expect(page.getByTestId('balance')).toBeVisible()
  await page.keyboard.press('Control+Shift+K')
  await expect(page.getByTestId('toast').first()).toContainText('+10 Credits')
  await page.goto('/wallet') // enabled for the rest of the tab session
  await expect(page.getByTestId('balance')).toBeVisible()
  await page.keyboard.press('Control+Shift+K')
  await expect(page.getByTestId('toast').first()).toContainText('+10 Credits')
  await page.reload()
  await expect(page.getByTestId('balance')).toContainText('30')

  await page.request.post('/api/dev/clawback')
  await page.reload()
  await expect(page.getByTestId('toast').first()).toContainText('20 cheated Credits were removed')
  await expect(page.getByTestId('balance')).toContainText('10')
  await page.reload() // acknowledged: shown only once
  await expect(page.getByTestId('balance')).toContainText('10')
  await expect(page.getByTestId('toast')).toHaveCount(0)
})

test('the playtest page warns when a blocker hides ad-like elements', async ({ browser }) => {
  const devCtx = await browser.newContext()
  const dev = await devCtx.newPage()
  await signIn(dev, `blockdev${Date.now()}@example.com`, 'Block Dev')
  const game = await (await dev.request.post('/api/games', {
    data: { title: 'Blocked Bird', pitch: 'A bird behind an ad blocker.', description: '', tags: [], playUrl: 'https://example.com/b', host: 'other', accessNotes: '', trailerUrl: null, coverKey: null, hoverClipKey: null, screenshotKeys: [] },
  })).json()
  const camp = await (await dev.request.post('/api/campaigns', {
    data: { gameId: game.id, buildLabel: 'v1', buildUrl: null, instructions: '', playtimePreset: 'quick', devices: 'desktop', slots: 1, price: 5, minReputation: 0, catalogIds: ['controls_feel'], custom: [] },
  })).json()
  await devCtx.close()

  const ctx = await browser.newContext()
  const page = await ctx.newPage()
  await signIn(page, `blocked${Date.now()}@example.com`, 'Blocky')
  const start = await (await page.request.post(`/api/campaigns/${camp.id}/start`)).json()
  const playtestId = start.playtestId ?? start.id
  await page.goto(`/play/${playtestId}`)
  await expect(page.getByTestId('consent')).toBeVisible()
  await expect(page.getByTestId('blocker-warning')).toHaveCount(0)

  // Simulate a cosmetic ad blocker.
  await page.addInitScript(() => {
    document.addEventListener('DOMContentLoaded', () => {
      const s = document.createElement('style')
      s.textContent = '.adsbox{display:none!important}'
      document.head.appendChild(s)
    })
  })
  await page.reload()
  await expect(page.getByTestId('blocker-warning')).toBeVisible()
  await ctx.close()
})
