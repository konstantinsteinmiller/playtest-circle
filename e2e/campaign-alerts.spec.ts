import { expect, test, type Page } from '@playwright/test'
import { FIXTURE_GAME_URL, signIn } from './helpers'

const ALICE = 'alerts-alice@example.com'

async function alertState(p: Page, ageDay = false) {
  return (await (await p.request.post('/api/dev/campaign-alert', { data: { email: ALICE, ageDay } })).json()) as {
    alertAt: number | null
    seenAt: number | null
  }
}

/** Publishes a 5-Credit, 1-slot campaign through the API (the wizard is covered elsewhere). */
async function publish(dev: Page, title: string) {
  const g = await dev.request.post('/api/games', { data: { title, pitch: 'A pitch long enough for the form.', playUrl: FIXTURE_GAME_URL } })
  expect(g.ok()).toBeTruthy()
  const gameId = (await g.json()).id as string
  const c = await dev.request.post('/api/campaigns', {
    data: { gameId, buildLabel: 'v1', playtimePreset: 'quick', slots: 1, price: 5, catalogIds: ['controls_feel'], custom: [] },
  })
  expect(c.ok()).toBeTruthy()
}

test('new-campaign emails are opt-in, at most daily, and re-armed by visiting the app', async ({ browser }) => {
  const aCtx = await browser.newContext()
  const alice = await aCtx.newPage()
  await signIn(alice, ALICE, 'Alice Alerts')
  await alice.goto('/settings')
  const box = alice.getByTestId('campaign-alerts')
  await expect(box).not.toBeChecked()
  await box.check()
  await expect(alice.getByRole('status')).toBeVisible()

  const dCtx = await browser.newContext()
  const dev = await dCtx.newPage()
  await signIn(dev, 'alerts-dev@example.com', 'Dan Dev')
  // Each new account has 10 Credits: two 5-Credit campaigns per dev.
  const eCtx = await browser.newContext()
  const dev2 = await eCtx.newPage()
  await signIn(dev2, 'alerts-dev2@example.com', 'Eve Dev')

  // First campaign: Alice is emailed.
  await publish(dev, 'Alert Alpaca')
  await expect.poll(async () => (await alertState(dev)).alertAt).not.toBeNull()
  const first = (await alertState(dev)).alertAt!

  // A day later but she hasn't been back: no second email.
  await alertState(dev, true)
  const aged = (await alertState(dev)).alertAt!
  await publish(dev, 'Alert Badger')
  await dev.waitForTimeout(1000)
  expect((await alertState(dev)).alertAt).toBe(aged)

  // She visits the app; the next campaign mails her again.
  await alice.goto('/browse')
  await expect.poll(async () => (await alertState(dev)).seenAt ?? 0).toBeGreaterThan(aged)
  await publish(dev2, 'Alert Camel')
  await expect.poll(async () => (await alertState(dev)).alertAt).toBeGreaterThan(first - 1)
  const third = (await alertState(dev)).alertAt!
  expect(third).toBeGreaterThan(aged)

  // Visited again, but within the same day: still only one email a day.
  await alice.goto('/browse')
  await publish(dev2, 'Alert Dingo')
  await dev.waitForTimeout(1000)
  expect((await alertState(dev)).alertAt).toBe(third)

  await aCtx.close()
  await dCtx.close()
  await eCtx.close()
})
