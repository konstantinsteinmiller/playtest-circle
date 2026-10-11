import { expect, test } from '@playwright/test'
import { FIXTURE_GAME_URL, serveFixtureGame, signIn } from './helpers'

/** A tester's browser dies mid-recording: the dev still gets the partial video and pays nothing. */
test('an interrupted recording is salvaged for the dev without Credits moving', async ({ browser }) => {
  test.setTimeout(180_000)
  const devCtx = await browser.newContext()
  const dev = await devCtx.newPage()
  await signIn(dev, 'carol@example.com', 'Carol Dev')
  await dev.goto('/studio/games/new')
  await dev.getByTestId('game-title').fill('Crash Cat')
  await dev.getByTestId('game-pitch').fill('A cat that keeps knocking the router off the desk.')
  await dev.getByTestId('next').click()
  await dev.getByTestId('game-url').fill(FIXTURE_GAME_URL)
  await dev.getByTestId('next').click()
  await dev.getByTestId('next').click()
  await dev.getByTestId('save-game').click()
  await dev.getByTestId('build-label').fill('v1')
  await dev.getByTestId('next').click()
  await dev.getByTestId('q-controls_feel').check()
  await dev.getByTestId('next').click()
  await dev.getByTestId('next').click()
  await dev.getByTestId('slots').fill('1')
  await dev.getByTestId('price').fill('10')
  await dev.getByTestId('next').click()
  await dev.getByTestId('publish').click()
  await expect(dev).toHaveURL(/published=1/)
  const resultsUrl = dev.url().split('?')[0]

  const ctx = await browser.newContext()
  await serveFixtureGame(ctx)
  const t = await ctx.newPage()
  await signIn(t, 'dave@example.com', 'Dave Tester')
  await t.goto('/browse')
  await t.getByRole('link', { name: 'Crash Cat' }).click()
  await t.getByTestId('start-playtest').click()
  await expect(t).toHaveURL(/\/play\//)
  const playtestId = t.url().split('/play/')[1]
  await t.getByTestId('consent').check()
  const [game] = await Promise.all([ctx.waitForEvent('page'), t.getByTestId('open-game').click()])
  await game.waitForLoadState()
  await t.bringToFront()
  await t.getByTestId('start-recording').click()
  // Record until the first 5 MB part has been uploaded, then "lose power".
  await expect(t.getByText(/[1-9]\d* parts? uploaded/)).toBeVisible({ timeout: 120_000 })
  await ctx.close()

  await dev.request.post('/api/dev/expire-and-cron', { data: { playtestId } })
  await dev.goto(resultsUrl)
  const row = dev.getByTestId('playtest-row').first()
  await expect(row).toContainText('Dave Tester')
  await expect(row).toContainText('Interrupted')
  await row.getByRole('link', { name: 'Review' }).click()
  const video = dev.getByTestId('recording')
  await expect.poll(async () => video.evaluate((v: HTMLVideoElement) => v.readyState), { timeout: 15_000 }).toBeGreaterThanOrEqual(1)
  // Escrow stays with the dev: 10 welcome − 10 escrow, slot freed, nothing paid.
  expect((await (await dev.request.get('/api/me')).json()).user.credits).toBe(0)
  await devCtx.close()
})
