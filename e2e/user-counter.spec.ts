import { expect, test } from '@playwright/test'
import { FIXTURE_GAME_URL, signIn } from './helpers'

type Stats = { active: number; online: number }

test('the homepage and How it works count active members and who is online', async ({ page }) => {
  const before = (await (await page.request.get('/api/stats')).json()) as Stats
  // Signing in alone doesn't count: only doing something does.
  await signIn(page, 'counter-user@example.com', 'Cora Counter')
  expect(((await (await page.request.get('/api/stats')).json()) as Stats).active).toBe(before.active)
  await page.request.post('/api/games', { data: { title: 'Count Crab', pitch: 'A pitch long enough for the form.', playUrl: FIXTURE_GAME_URL } })
  const after = (await (await page.request.get('/api/stats')).json()) as Stats
  expect(after.active).toBe(before.active + 1)
  expect(after.online).toBeGreaterThanOrEqual(1)
  expect(after.online).toBeLessThanOrEqual(after.active)

  for (const path of ['/', '/how-it-works']) {
    await page.goto(path)
    await expect(page.getByTestId('user-counter')).toContainText(`${after.active} member`)
    await expect(page.getByTestId('user-counter')).toContainText('online in the last hour')
  }
})
