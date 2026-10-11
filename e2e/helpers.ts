import { expect, type BrowserContext, type Page } from '@playwright/test'

export const FIXTURE_GAME_URL = 'https://fixture-game.test/play'

/** A tiny "game": animated canvas + a tone, titled so the tab-capture flag can pick it. */
const FIXTURE_HTML = `<!doctype html><html><head><title>Fixture Game</title></head>
<body style="margin:0;background:#123">
<h1 style="color:#fff;font-family:sans-serif">Fixture Game HUD</h1>
<canvas id="c" width="640" height="360"></canvas>
<script>
const x = document.getElementById('c').getContext('2d'); let t = 0
;(function f(){ t++; x.fillStyle='hsl('+(t%360)+',80%,50%)'; x.fillRect(0,0,640,360)
x.fillStyle='#fff'; x.fillRect((t*4)%640,150,60,60); requestAnimationFrame(f) })()
</script></body></html>`

export async function serveFixtureGame(context: BrowserContext) {
  await context.route('https://fixture-game.test/**', (route) => route.fulfill({ contentType: 'text/html', body: FIXTURE_HTML }))
}

export async function signIn(page: Page, email: string, name: string) {
  const res = await page.request.post('/api/auth/dev-login', { data: { email, name } })
  expect(res.ok()).toBeTruthy()
  await page.request.patch('/api/me', { data: { onboarded: true } })
}
