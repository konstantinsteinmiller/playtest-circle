import { expect, test } from '@playwright/test'

test('onboarding video plays through its scenes and can be paused and scrubbed', async ({ page }) => {
  await page.goto('/how-it-works')
  const video = page.getByTestId('onboarding-video')
  await expect(video).toBeVisible()
  await expect(page.getByTestId('video-title')).toHaveText('Test games, earn Credits')
  // Autoplays: the second scene follows after about 6 s.
  await expect(page.getByTestId('video-title')).toHaveText('Add your game', { timeout: 10_000 })
  await page.getByTestId('video-pause').click()
  await expect(page.getByTestId('video-play')).toBeVisible()
  await page.getByRole('button', { name: /Scene 4/ }).click()
  await expect(page.getByTestId('video-title')).toHaveText('Watch and learn')
})
