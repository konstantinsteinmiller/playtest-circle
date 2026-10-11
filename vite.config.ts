import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'
import { cloudflare } from '@cloudflare/vite-plugin'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig(({ command }) => {
  // The dev server runs the Worker in its fully local "dev" environment unless told otherwise
  // (Playwright sets CLOUDFLARE_ENV=e2e). Builds always target production.
  if (command === 'serve') process.env.CLOUDFLARE_ENV ??= 'dev'
  const persist = process.env.CLOUDFLARE_ENV === 'e2e' ? { path: '.wrangler/e2e-state' } : true

  return {
    plugins: [vue(), tailwindcss(), cloudflare({ persistState: persist })],
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
        '@shared': fileURLToPath(new URL('./shared', import.meta.url)),
      },
    },
  }
})
