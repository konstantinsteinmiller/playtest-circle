import { expect, test, type Browser } from '@playwright/test'
import { FIXTURE_GAME_URL, serveFixtureGame, signIn } from './helpers'

async function publishCampaign(browser: Browser, email: string, name: string, title: string) {
  const ctx = await browser.newContext()
  const dev = await ctx.newPage()
  await signIn(dev, email, name)
  await dev.goto('/studio/games/new')
  await dev.getByTestId('game-title').fill(title)
  await dev.getByTestId('game-pitch').fill('A goose that steals every save point in the level.')
  await dev.getByTestId('next').click()
  await dev.getByTestId('game-url').fill(FIXTURE_GAME_URL)
  await dev.getByTestId('next').click()
  await dev.getByTestId('next').click()
  await dev.getByTestId('save-game').click()
  await dev.getByTestId('build-label').fill('v1')
  await dev.getByTestId('next').click()
  await dev.getByTestId('q-controls_feel').check()
  await dev.getByTestId('next').click()
  await dev.getByTestId('next').click() // quick preset: min 3 "minutes" = 3 s in e2e
  await dev.getByTestId('slots').fill('1')
  await dev.getByTestId('price').fill('10')
  await dev.getByTestId('next').click()
  await dev.getByTestId('publish').click()
  await expect(dev).toHaveURL(/published=1/)
  return ctx
}

/**
 * A first-time visitor browses and tests without an account, stops less than a minute early but explains why
 * in 60+ characters (so still earns), comments on the game, and keeps it all when signing in with Google.
 */
test('a guest tests, quits inside the grace window, comments and links Google', async ({ browser }) => {
  const devCtx = await publishCampaign(browser, 'gina@example.com', 'Gina Dev', 'Guest Goose')

  const ctx = await browser.newContext()
  await serveFixtureGame(ctx)
  const t = await ctx.newPage()
  await t.goto('/browse')
  expect((await (await t.request.get('/api/me')).json()).user).toBeNull()
  await t.getByRole('link', { name: 'Guest Goose' }).click()
  await expect(t).toHaveURL(/\/c\//)
  const campaignUrl = t.url()
  await expect(t.getByTestId('guest-hint')).toBeVisible()
  await t.getByTestId('start-playtest').click()
  await expect(t).toHaveURL(/\/play\//)
  expect((await (await t.request.get('/api/me')).json()).user.guest).toBe(true)

  await t.getByTestId('consent').check()
  const [game] = await Promise.all([ctx.waitForEvent('page'), t.getByTestId('open-game').click()])
  await game.waitForLoadState()
  await t.bringToFront()
  await t.getByTestId('start-recording').click()
  // Stop just past 2 s: short of the 3 s minimum, but inside the 1 "minute" grace window.
  t.once('dialog', (d) => d.accept())
  await expect(t.getByTestId('elapsed')).toHaveText('0:02', { timeout: 10_000 })
  await t.getByTestId('stop').click()

  await expect(t.getByTestId('quit-grace-notice')).toBeVisible()
  await expect(t.getByTestId('video-received')).toBeVisible()
  const fields = t.locator('fieldset')
  const count = await fields.count()
  for (let i = 0; i < count; i++) {
    const radios = fields.nth(i).getByRole('radio')
    if (await radios.count()) await radios.nth(3).click()
    await fields.nth(i).locator('textarea').fill('Short note.')
  }
  const counter = t.getByTestId('chars-sys_quit_reason')
  await expect(counter).toHaveText('11 / 60 characters')
  const quit = fields.filter({ has: counter }).locator('textarea')
  await quit.fill('I had to stop because the second level never loaded on my laptop at all.')
  await expect(counter).toContainText('✓')
  await t.getByTestId('submit-feedback').click()
  await expect(t.getByTestId('result')).toContainText('10 Credits were added')

  // Comment on the game page as the guest.
  await t.goto(campaignUrl)
  await t.getByTestId('game-page-link').click()
  await expect(t).toHaveURL(/\/g\//)
  const gameUrl = t.url()
  await t.getByTestId('comment-text').fill('Loved the goose honk, the save-point theft is hilarious.')
  await t.getByTestId('post-comment').click()
  await expect(t.getByTestId('comment').first()).toContainText('Guest')

  // Guests may use the studio, warned that their games live only in this browser.
  await t.goto('/studio')
  await expect(t.getByTestId('studio-guest-warning')).toBeVisible()

  // Signing in with Google upgrades the guest in place: Credits, playtest and comment stay.
  await t.request.post('/api/auth/dev-login', { data: { email: 'gus@example.com', name: 'Gus Tester' } })
  const me = (await (await t.request.get('/api/me')).json()).user
  expect(me.guest).toBe(false)
  expect(me.credits).toBe(20) // 10 earned + 10 welcome grant
  await t.goto(gameUrl)
  await expect(t.getByTestId('comment').first()).toContainText('Gus Tester')

  await ctx.close()
  await devCtx.close()
})

test('a guest who signs into an existing account is merged into it', async ({ browser }) => {
  const devCtx = await publishCampaign(browser, 'hal@example.com', 'Hal Dev', 'Merge Moose')
  const existing = await browser.newContext()
  await signIn(await existing.newPage(), 'ivy@example.com', 'Ivy Member')

  const ctx = await browser.newContext()
  const t = await ctx.newPage()
  await t.goto('/games')
  await t.getByRole('link', { name: 'Merge Moose' }).click()
  await expect(t.getByTestId('game-campaigns')).toContainText('v1')
  await t.getByTestId('comment-text').fill('Commented before I had an account.')
  await t.getByTestId('post-comment').click()
  await expect(t.getByTestId('comment').first()).toContainText('Guest')
  const guestId = (await (await t.request.get('/api/me')).json()).user.id

  await t.request.post('/api/auth/dev-login', { data: { email: 'ivy@example.com', name: 'Ivy Member' } })
  const me = (await (await t.request.get('/api/me')).json()).user
  expect(me.id).not.toBe(guestId)
  expect(me.credits).toBe(10)
  await t.reload()
  await expect(t.getByTestId('comment').first()).toContainText('Ivy Member')

  await ctx.close()
  await existing.close()
  await devCtx.close()
})

test('"Try as guest" on the landing starts a guest who may open the studio', async ({ page }) => {
  await page.goto('/')
  await page.getByTestId('try-guest').click()
  await expect(page).toHaveURL(/\/browse/)
  expect((await (await page.request.get('/api/me')).json()).user.guest).toBe(true)
  await page.goto('/studio')
  await expect(page.getByTestId('studio-guest-warning')).toBeVisible()
})
