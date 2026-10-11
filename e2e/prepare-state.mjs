// Runs before the e2e web server starts: a fresh local D1 + R2 for every run.
import { execSync } from 'node:child_process'
import { rmSync } from 'node:fs'

rmSync('.wrangler/e2e-state', { recursive: true, force: true })
execSync('npx wrangler d1 migrations apply playtest-circle --local --env e2e --persist-to .wrangler/e2e-state', { stdio: 'inherit' })
