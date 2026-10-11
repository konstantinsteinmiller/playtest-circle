import { defineConfig } from 'vitest/config'
import { fileURLToPath, URL } from 'node:url'

// Separate from vite.config.ts: unit tests run in Node without the Cloudflare/Vue plugins.
export default defineConfig({
  resolve: {
    alias: {
      '@shared': fileURLToPath(new URL('./shared', import.meta.url)),
      'cloudflare:sockets': fileURLToPath(new URL('./tests/stubs/sockets.ts', import.meta.url)),
    },
  },
  test: { include: ['tests/**/*.test.ts'] },
})
