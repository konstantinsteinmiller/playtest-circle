import { expect, test } from '@playwright/test'
import { signIn } from './helpers'

test('game and campaign forms survive a reload as drafts', async ({ page }) => {
  await signIn(page, 'drafty@example.com', 'Drafty')

  await page.goto('/studio/games/new')
  await page.getByTestId('game-title').fill('Unsaved Sloth')
  await page.getByTestId('game-pitch').fill('A sloth racing game that is very, very slow.')
  await page.getByTestId('next').click()
  await page.getByTestId('game-url').fill('https://example.com/sloth')
  await page.waitForTimeout(500) // drafts save debounced
  await page.reload()

  await expect(page.getByText('We restored your unsaved draft.')).toBeVisible()
  await expect(page.getByTestId('game-url')).toHaveValue('https://example.com/sloth') // same step restored
  await page.getByRole('button', { name: /Basics/ }).click()
  await expect(page.getByTestId('game-title')).toHaveValue('Unsaved Sloth')

  // Saving clears the draft.
  await page.getByTestId('next').click()
  await page.getByTestId('next').click()
  await page.getByTestId('next').click()
  await page.getByTestId('save-game').click()
  await expect(page).toHaveURL(/\/studio\/campaigns\/new/)
  await page.goto('/studio/games/new')
  await expect(page.getByTestId('game-title')).toHaveValue('')
  await expect(page.getByText('We restored your unsaved draft.')).toHaveCount(0)

  // Campaign wizard: label + picked questions survive.
  await page.goto('/studio/campaigns/new')
  await page.getByTestId('build-label').fill('v9 draft test')
  await page.getByTestId('next').click()
  await page.getByTestId('q-bosses_too_easy').check()
  await page.waitForTimeout(500)
  await page.reload()
  await expect(page.getByTestId('q-bosses_too_easy')).toBeChecked()
  await page.getByRole('button', { name: /Game & build/ }).click()
  await expect(page.getByTestId('build-label')).toHaveValue('v9 draft test')
})
