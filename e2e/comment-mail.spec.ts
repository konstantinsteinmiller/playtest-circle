import { expect, test } from '@playwright/test'
import { FIXTURE_GAME_URL, signIn } from './helpers'

const OWNER = 'mail-owner@example.com'

/** The first new comment of the day is emailed to the game's owner with a link that lands on that comment. */
test('the first comment of the day is emailed to the dev, the rest stay in the app', async ({ browser }) => {
  const oCtx = await browser.newContext()
  const owner = await oCtx.newPage()
  await signIn(owner, OWNER, 'Olive Owner')
  const g = await owner.request.post('/api/games', { data: { title: 'Mail Moose', pitch: 'A moose that delivers the post.', playUrl: FIXTURE_GAME_URL } })
  const gameId = (await g.json()).id as string
  const state = async () => (await (await owner.request.post('/api/dev/campaign-alert', { data: { email: OWNER } })).json()).commentMailAt as number | null
  expect(await state()).toBeNull()

  const cCtx = await browser.newContext()
  const fan = await cCtx.newPage()
  await signIn(fan, 'mail-fan@example.com', 'Finn Fan')
  const first = await fan.request.post(`/api/games/${gameId}/comments`, { data: { text: 'The antlers clipping through the mailbox made me laugh.' } })
  const commentId = (await first.json()).id as string
  await expect.poll(state).not.toBeNull()
  const mailedAt = await state()

  await fan.request.post(`/api/games/${gameId}/comments`, { data: { text: 'Second thought: the sprint is too slow.' } })
  await owner.waitForTimeout(1000)
  expect(await state()).toBe(mailedAt)

  // The email's link opens the game page on that comment, highlighted.
  await owner.goto(`/g/${gameId}#comment-${commentId}`)
  const target = owner.locator(`#comment-${commentId}`)
  await expect(target).toContainText('antlers clipping')
  await expect(target).toHaveClass(/border-primary/)
  await expect(target).toBeInViewport()

  await oCtx.close()
  await cCtx.close()
})
