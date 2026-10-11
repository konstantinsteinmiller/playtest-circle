import { expect, test } from '@playwright/test'
import { signIn } from './helpers'

test('social posts earn Credits up to three times', async ({ page }) => {
  await signIn(page, 'social@example.com', 'Social Sam')
  await page.goto('/wallet')
  const box = page.getByTestId('social-claim')
  await expect(box).toBeVisible()
  await expect(page.getByTestId('social-template')).toHaveValue(/quid pro quo[\s\S]*https:\/\/app\.playtest-circle\.workers\.dev\//)
  await page.getByTestId('social-url').fill('https://example.com/not-social')
  await page.getByTestId('social-submit').click()
  await expect(box.getByRole('alert')).toContainText("doesn't look like")
  for (const n of [1, 2, 3]) {
    await page.getByTestId('social-url').fill(`https://bsky.app/profile/sam.bsky.social/post/${n}`)
    await page.getByTestId('social-submit').click()
    await expect(box.getByRole('status')).toContainText('+20 Credits')
  }
  await expect(page.getByTestId('balance')).toContainText('70')
  await expect(box).toContainText('claimed all 3')
  const again = await page.request.post('/api/me/social-claims', { data: { url: 'https://x.com/sam/status/9' } })
  expect(again.status()).toBe(409)
})
