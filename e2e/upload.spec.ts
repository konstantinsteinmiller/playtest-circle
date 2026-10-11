import { expect, test } from '@playwright/test'
import { signIn } from './helpers'

// 1×1 PNG
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')

test('drop zones upload images and reject wrong file types', async ({ page }) => {
  await signIn(page, 'dropper@example.com', 'Dropper')
  await page.goto('/studio/games/new')
  await page.getByTestId('game-title').fill('Drop Test')
  await page.getByTestId('game-pitch').fill('Testing the drag and drop zones.')
  await page.getByTestId('next').click()
  await page.getByTestId('game-url').fill('https://example.com/drop')
  await page.getByTestId('next').click()

  // Drop a real PNG onto the cover zone.
  const zone = page.getByTestId('drop-image').first()
  const dt = await page.evaluateHandle((b64) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
    const d = new DataTransfer()
    d.items.add(new File([bytes], 'cover.png', { type: 'image/png' }))
    return d
  }, PNG.toString('base64'))
  await zone.dispatchEvent('drop', { dataTransfer: dt })
  await expect(page.locator('img[src*="media"]').first()).toBeVisible({ timeout: 10_000 })

  // A GIF is refused with a message.
  await zone.locator('input').setInputFiles({ name: 'x.gif', mimeType: 'image/gif', buffer: PNG })
  await expect(page.getByRole('alert')).toContainText('.webp, .png, .jpeg, .jpg')
  await page.getByTestId('drop-clip').locator('input').setInputFiles({ name: 'x.webm', mimeType: 'video/webm', buffer: PNG })
  await expect(page.getByRole('alert').last()).toContainText('.mp4')
})
