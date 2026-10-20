import { expect, test } from '@playwright/test'
import { FIXTURE_GAME_URL, signIn } from './helpers'

test('a user hearts games and tabs between favorites and all games', async ({ page }) => {
  await signIn(page, 'fav-fan@example.com', 'Fay Fan')
  for (const title of ['Heart Heron', 'Plain Pelican']) {
    const g = await page.request.post('/api/games', { data: { title, pitch: 'A pitch long enough for the form.', playUrl: FIXTURE_GAME_URL } })
    expect(g.ok()).toBeTruthy()
  }
  await page.goto('/games')
  const heron = page.locator('article', { hasText: 'Heart Heron' })
  await heron.getByTestId('favorite').click()
  await expect(heron.getByTestId('favorite')).toHaveAttribute('aria-pressed', 'true')

  await page.getByTestId('games-tab-favorites').click()
  await expect(page.locator('article', { hasText: 'Heart Heron' })).toBeVisible()
  await expect(page.locator('article', { hasText: 'Plain Pelican' })).toHaveCount(0)

  // Survives a reload, and un-hearting empties the tab.
  await page.reload()
  await page.getByTestId('games-tab-favorites').click()
  await page.locator('article', { hasText: 'Heart Heron' }).getByTestId('favorite').click()
  await expect(page.locator('article')).toHaveCount(0)
  await page.getByTestId('games-tab-all').click()
  await expect(page.locator('article', { hasText: 'Plain Pelican' })).toBeVisible()
})
