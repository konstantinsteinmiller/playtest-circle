import { expect, test } from '@playwright/test'
import { FIXTURE_GAME_URL, signIn } from './helpers'

/** Long instructions and a big catalog push the button below the fold; it must stay on screen. */
for (const vp of [{ width: 1440, height: 800 }, { width: 390, height: 760 }]) {
  test(`"Start playtest" stays visible on a long campaign page (${vp.width}px)`, async ({ browser }) => {
    const dCtx = await browser.newContext()
    const dev = await dCtx.newPage()
    await signIn(dev, `footer-dev-${vp.width}@example.com`, 'Fred Footer')
    const g = await dev.request.post('/api/games', { data: { title: `Footer Fox ${vp.width}`, pitch: 'A pitch long enough for the form.', playUrl: FIXTURE_GAME_URL } })
    const c = await dev.request.post('/api/campaigns', {
      data: {
        gameId: (await g.json()).id, buildLabel: 'v1', playtimePreset: 'quick', slots: 1, price: 5, custom: [],
        catalogIds: ['controls_feel'], instructions: 'Play it all the way through, please.\n'.repeat(50),
      },
    })
    expect(c.ok()).toBeTruthy()
    const id = (await c.json()).id as string

    const ctx = await browser.newContext({ viewport: vp })
    const page = await ctx.newPage()
    await signIn(page, `footer-tester-${vp.width}@example.com`, 'Tess Tester')
    await page.goto(`/c/${id}`)
    const btn = page.getByTestId('start-playtest')
    await expect(btn).toBeInViewport()
    await page.mouse.wheel(0, 1500)
    await expect(btn).toBeInViewport()
    await page.screenshot({ path: `test-results/start-footer-${vp.width}.png` })
    await ctx.close()
    await dCtx.close()
  })
}
