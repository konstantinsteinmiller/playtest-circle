// Renders public/og-image.png (1200×630) from the logo and brand colours. Run: node scripts/og-image.mjs
import { chromium } from '@playwright/test'
import { readFileSync } from 'node:fs'

const logo = readFileSync(new URL('../public/logo.svg', import.meta.url), 'utf8')
const html = `<!doctype html><html><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@500;600&family=Space+Grotesk:wght@700&display=swap" rel="stylesheet">
<style>
  html,body{margin:0;width:1200px;height:630px;background:#0B0B10;color:#F7F7F2;font-family:Inter,sans-serif;overflow:hidden}
  .glow1{position:absolute;width:520px;height:520px;border-radius:50%;background:#C6FF3D;opacity:.18;filter:blur(110px);top:-180px;right:-120px}
  .glow2{position:absolute;width:460px;height:460px;border-radius:50%;background:#FF3DA5;opacity:.16;filter:blur(110px);bottom:-200px;left:-140px}
  .wrap{position:absolute;inset:0;display:flex;align-items:center;gap:64px;padding:0 90px}
  .logo svg{width:300px;height:300px}
  .chip{display:inline-block;border:3px solid #C6FF3D;color:#C6FF3D;border-radius:999px;padding:8px 22px;font-weight:600;font-size:26px}
  h1{font-family:'Space Grotesk',sans-serif;font-size:92px;line-height:.98;margin:26px 0 22px;letter-spacing:-2px}
  p{font-size:31px;line-height:1.35;color:#C2C2CF;margin:0;max-width:640px}
  .foot{position:absolute;bottom:38px;left:90px;right:90px;display:flex;justify-content:space-between;font-size:24px;font-weight:600;color:#C2C2CF}
  .foot b{color:#C6FF3D}
</style></head><body>
<div class="glow1"></div><div class="glow2"></div>
<div class="wrap"><div class="logo">${logo}</div>
<div><span class="chip">Quid pro quo playtesting</span>
<h1>Playtest<br>Circle</h1>
<p>Game devs test each other's games — recorded sessions, real answers, Credits for every test.</p></div></div>
<div class="foot"><span>Free &amp; <b>open source</b></span><span>app.playtest-circle.workers.dev</span></div>
</body></html>`

const browser = await chromium.launch({ channel: 'chrome' })
const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 })
await page.setContent(html, { waitUntil: 'networkidle' })
await page.evaluate(() => document.fonts.ready)
await page.screenshot({ path: new URL('../public/og-image.png', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1') })
await browser.close()
console.log('wrote public/og-image.png')
