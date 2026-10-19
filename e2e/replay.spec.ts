import { expect, test, type Page } from '@playwright/test'
import { FIXTURE_GAME_URL, serveFixtureGame, signIn } from './helpers'

const credits = async (p: Page) => (await (await p.request.get('/api/me')).json()).user.credits as number

/**
 * After a playtest the studio asks that tester to replay an improved build: a private one-slot campaign paid
 * into escrow. Nobody else can see or take it; a decline refunds the studio, and the replay pays out like any test.
 */
test('a studio requests a replay from one tester, who can decline it or play it', async ({ browser }) => {
  // ---------------------------------------------------------------- dev publishes (5 Credits, 1 slot)
  const devCtx = await browser.newContext()
  const dev = await devCtx.newPage()
  await signIn(dev, 'rita@example.com', 'Rita Dev')
  await dev.goto('/studio/games/new')
  await dev.getByTestId('game-title').fill('Replay Raccoon')
  await dev.getByTestId('game-pitch').fill('A raccoon that rewinds time whenever it drops the loot.')
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
  await dev.getByTestId('price').fill('5')
  await dev.getByTestId('next').click()
  await dev.getByTestId('publish').click()
  await expect(dev).toHaveURL(/published=1/)
  const resultsUrl = dev.url().split('?')[0]
  expect(await credits(dev)).toBe(5)

  // ---------------------------------------------------------------- tester plays it through
  const testerCtx = await browser.newContext()
  await serveFixtureGame(testerCtx)
  const tester = await testerCtx.newPage()
  await signIn(tester, 'ray@example.com', 'Ray Tester')

  async function playThrough() {
    await expect(tester).toHaveURL(/\/play\//)
    await tester.getByTestId('consent').check()
    const [game] = await Promise.all([testerCtx.waitForEvent('page'), tester.getByTestId('open-game').click()])
    await game.waitForLoadState()
    await tester.bringToFront()
    await tester.getByTestId('start-recording').click()
    await expect(tester.getByTestId('elapsed')).toBeVisible()
    await tester.waitForTimeout(4000) // past the 3 s minimum
    await tester.getByTestId('stop').click()
    const fields = tester.locator('fieldset')
    await expect(fields.first()).toBeVisible()
    await expect(tester.getByTestId('video-received')).toBeVisible()
    const count = await fields.count()
    for (let i = 0; i < count; i++) {
      const radios = fields.nth(i).getByRole('radio')
      if (await radios.count()) await radios.nth(3).click()
      await fields.nth(i).locator('textarea').fill('The jump feels floaty on the second level.')
    }
    await tester.getByTestId('submit-feedback').click()
    await expect(tester.getByTestId('result')).toContainText('Credits were added')
    await game.close()
  }

  await tester.goto('/browse')
  await tester.getByRole('link', { name: 'Replay Raccoon' }).click()
  await tester.getByTestId('start-playtest').click()
  await playThrough()
  const testerAfterFirst = await credits(tester)

  // ---------------------------------------------------------------- dev requests a replay
  await dev.goto(resultsUrl)
  await dev.getByTestId('request-replay').click()
  await dev.getByTestId('replay-build').fill('v2')
  await dev.getByTestId('replay-notes').fill('Fixed the floaty jump. Does level 2 feel better now?')
  await dev.getByTestId('replay-submit').click()
  await expect(dev.getByTestId('replay-pending')).toBeVisible()
  expect(await credits(dev)).toBe(0)

  // A second open request for the same session is refused.
  const firstCampaign = resultsUrl.split('/').pop()!
  const results = await (await dev.request.get(`/api/campaigns/${firstCampaign}/results`)).json()
  const playtestId = results.playtests[0].id as string
  const replayId = results.replays[0].id as string
  const dup = await dev.request.post(`/api/campaigns/${firstCampaign}/replays`, { data: { playtestId, price: 5 } })
  expect(dup.status()).toBe(409)

  // Private: hidden from Browse and from anyone but the tester and the studio.
  const otherCtx = await browser.newContext()
  const other = await otherCtx.newPage()
  await signIn(other, 'olga@example.com', 'Olga Other')
  expect((await other.request.get(`/api/campaigns/${replayId}`)).status()).toBe(404)
  expect((await other.request.post(`/api/campaigns/${replayId}/start`)).status()).toBe(404)
  const browse = await (await other.request.get('/api/campaigns')).json()
  expect(browse.campaigns.map((c: { id: string }) => c.id)).not.toContain(replayId)
  await otherCtx.close()

  // ---------------------------------------------------------------- tester declines: the studio is refunded
  await tester.goto('/browse')
  const invites = tester.getByTestId('replay-invites')
  await expect(invites).toBeVisible()
  await invites.getByRole('link', { name: 'Replay Raccoon' }).click()
  await expect(tester.getByTestId('replay-banner')).toContainText('Rita Dev asked you to replay')
  tester.once('dialog', (d) => d.accept())
  await tester.getByTestId('decline-replay').click()
  await expect(tester).toHaveURL(/\/browse/)
  expect(await credits(dev)).toBe(5)

  // ---------------------------------------------------------------- a new request, played this time
  await dev.goto(resultsUrl)
  await dev.getByTestId('request-replay').click()
  await dev.getByTestId('replay-build').fill('v3')
  await dev.getByTestId('replay-submit').click()
  await expect(dev.getByTestId('replay-pending')).toBeVisible()

  await tester.goto('/browse')
  await tester.getByTestId('replay-invites').getByRole('link', { name: 'Replay Raccoon' }).click()
  await tester.getByTestId('start-playtest').click()
  await playThrough()
  expect(await credits(tester)).toBe(testerAfterFirst + 5)

  await devCtx.close()
  await testerCtx.close()
})
