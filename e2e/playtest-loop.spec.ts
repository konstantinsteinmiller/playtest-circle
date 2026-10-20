import { expect, test } from '@playwright/test'
import { FIXTURE_GAME_URL, serveFixtureGame, signIn } from './helpers'

/**
 * The whole quid-pro-quo loop with real tab capture:
 * dev posts a game + campaign → tester records a session and answers → Credits move →
 * dev reviews the recording, jumps to a note, rates it and deletes it for the tidy bonus.
 */
test('dev posts, tester plays and earns, dev reviews and tidies up', async ({ browser }) => {
  // ---------------------------------------------------------------- dev publishes
  const devCtx = await browser.newContext()
  const dev = await devCtx.newPage()
  await signIn(dev, 'alice@example.com', 'Alice Dev')

  await dev.goto('/studio/games/new')
  await dev.getByTestId('game-title').fill('Doom Duck')
  await dev.getByTestId('game-pitch').fill('A duck with a shotgun saves the pond from robot frogs.')
  await dev.getByTestId('next').click()
  await dev.getByTestId('game-url').fill(FIXTURE_GAME_URL)
  await dev.getByTestId('next').click()
  await dev.getByTestId('next').click()
  await dev.getByTestId('save-game').click()

  await expect(dev).toHaveURL(/\/studio\/campaigns\/new/)
  await dev.getByTestId('build-label').fill('v0.1 first boss')
  await dev.getByTestId('devices-desktop_mobile').click()
  await dev.getByTestId('next').click()
  await dev.getByTestId('q-controls_feel').check()
  await dev.getByTestId('q-stuck_where').check()
  await dev.getByTestId('next').click()
  await dev.getByTestId('next').click() // quick preset (min 3 "minutes" = 3 s in e2e)
  await dev.getByTestId('slots').fill('1')
  await dev.getByTestId('price').fill('10')
  await dev.getByTestId('next').click()
  await dev.getByTestId('publish').click()
  await expect(dev).toHaveURL(/\/studio\/campaigns\/\w+\?published=1/)
  const resultsUrl = dev.url().split('?')[0]
  expect((await (await dev.request.get('/api/me')).json()).user.credits).toBe(0)
  // The 10 Credits sit in the campaign, and the wallet says so next to the balance.
  expect((await (await dev.request.get('/api/me')).json()).user.reserved).toBe(10)
  await dev.goto('/wallet')
  await expect(dev.getByTestId('reserved')).toContainText('10 reserved')

  // ---------------------------------------------------------------- tester plays
  const testerCtx = await browser.newContext()
  await serveFixtureGame(testerCtx)
  const tester = await testerCtx.newPage()
  await signIn(tester, 'bob@example.com', 'Bob Tester')

  await tester.goto('/browse')
  await tester.getByRole('link', { name: 'Doom Duck' }).click()
  await expect(tester).toHaveURL(/\/c\//)
  const campaignUrl = tester.url()
  await tester.getByTestId('start-playtest').click()
  await expect(tester).toHaveURL(/\/play\//)

  await expect(tester.getByTestId('device-instructions')).toContainText('Desktop + mobile')
  await tester.getByTestId('consent').check()
  // Mic is asked before the game opens, so recording starts right after the tab is shared.
  await tester.getByTestId('mic').check()
  await expect(tester.getByTestId('mic-state')).toContainText('Microphone ready')
  const [gameTab] = await Promise.all([testerCtx.waitForEvent('page'), tester.getByTestId('open-game').click()])
  await gameTab.waitForLoadState()
  await expect(gameTab).toHaveTitle('Fixture Game')
  await expect(tester.getByTestId('game-opened-next')).toContainText('Start recording')
  await tester.screenshot({ path: 'test-results/game-opened-next.png' })
  await tester.bringToFront()

  await tester.getByTestId('start-recording').click()
  await expect(tester.getByTestId('elapsed')).toBeVisible()
  expect((await (await tester.request.get(tester.url().replace('/play/', '/api/playtests/'))).json()).playtest.usedMic).toBe(true)

  await tester.waitForTimeout(1500)
  await tester.getByTestId('mark-moment').click()
  await tester.getByTestId('note-text').fill('Boss intro is too long')
  await tester.getByTestId('save-note').click()
  await expect(tester.getByText('Boss intro is too long')).toBeVisible()

  await tester.waitForTimeout(3000) // past the 3 s minimum
  await tester.getByTestId('stop').click()

  // Questionnaire: pick a rating and write a comment everywhere.
  const fields = tester.locator('fieldset')
  await expect(fields.first()).toBeVisible()
  await expect(tester.getByTestId('video-received')).toBeVisible()
  // An accidental reload mid-questionnaire keeps the answers and the uploaded recording.
  await fields.first().locator('textarea').fill('Typed before the reload')
  await tester.waitForTimeout(500)
  tester.once('dialog', (d) => d.accept())
  await tester.reload()
  await expect(fields.first().locator('textarea')).toHaveValue('Typed before the reload')
  const count = await fields.count()
  for (let i = 0; i < count; i++) {
    const f = fields.nth(i)
    const radios = f.getByRole('radio')
    if (await radios.count()) await radios.nth(3).click()
    await f.locator('textarea').fill('Clear feedback: the second room loses momentum.')
  }
  await tester.getByTestId('submit-feedback').click()
  await expect(tester.getByTestId('result')).toContainText('10 Credits were added')
  expect((await (await tester.request.get('/api/me')).json()).user.credits).toBe(20)
  // Back on the campaign, the reward card is framed and says what was earned instead of the price.
  await tester.goto(campaignUrl)
  await expect(tester.getByTestId('earned')).toHaveText('✓ You earned 10 Credits already')
  await expect(tester.getByTestId('reward-card').locator('.pill-credit')).toHaveCount(0)
// The tester finds the playtest in their studio and can watch their own recording.  await tester.goto('/studio')  await tester.getByTestId('studio-tab-tested').click()  await expect(tester).toHaveURL(/tab=tested/)  await tester.getByTestId('tested-row').first().getByTestId('watch-own').click()  await expect(tester.locator('video')).toBeVisible()  await expect(tester.getByTestId('back-tested')).toBeVisible()

  // ---------------------------------------------------------------- dev reviews
  await dev.goto(resultsUrl)
  const row = dev.getByTestId('playtest-row').first()
  await expect(row).toContainText('Bob Tester')
  await expect(row).toContainText('Paid')
  await row.getByRole('link', { name: 'Review' }).click()

  const video = dev.getByTestId('recording')
  await expect(video).toBeVisible()
  await expect
    .poll(async () => video.evaluate((v: HTMLVideoElement) => v.readyState), { timeout: 15_000 })
    .toBeGreaterThanOrEqual(1)
  // Jump-to-note must land near the marked offset (the seekability spike).
  await dev.getByTestId('note-jump').first().click()
  await expect
    .poll(async () => video.evaluate((v: HTMLVideoElement) => v.currentTime), { timeout: 10_000 })
    .toBeGreaterThan(0.8)

  await dev.getByRole('button', { name: /Helpful/ }).first().click()
  dev.once('dialog', (d) => d.accept())
  await dev.getByTestId('delete-recording').click()
  await expect(dev.getByText('Thanks for tidying up')).toBeVisible()
  expect((await (await dev.request.get('/api/me')).json()).user.credits).toBe(1)

  const profile = await (await dev.request.get(`/api/users/${(await (await tester.request.get('/api/me')).json()).user.id}`)).json()
  expect(profile.user.repUp).toBe(1)

  await devCtx.close()
  await testerCtx.close()
})
