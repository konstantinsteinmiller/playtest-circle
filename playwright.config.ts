import { defineConfig } from '@playwright/test'

const PORT = 5199

export default defineConfig({
  testDir: 'e2e',
  timeout: 120_000,
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: `http://localhost:${PORT}`,
    channel: 'chrome',
    launchOptions: {
      args: [
        // Pick the fixture game's tab in the getDisplayMedia picker without a human.
        '--auto-select-tab-capture-source-by-title=Fixture Game',
        '--use-fake-ui-for-media-stream',
        '--use-fake-device-for-media-stream',
        '--autoplay-policy=no-user-gesture-required',
      ],
    },
    trace: 'retain-on-failure',
  },
  webServer: {
    command: `node e2e/prepare-state.mjs && npx vite --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}/api/config`,
    env: { CLOUDFLARE_ENV: 'e2e' },
    reuseExistingServer: false,
    timeout: 120_000,
  },
})
