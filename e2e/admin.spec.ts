import { expect, test } from '@playwright/test'
import { signIn } from './helpers'

test('admin panel is password gated and can warn and ban users', async ({ browser }) => {
  const stamp = Date.now()
  // A member who misbehaves.
  const userCtx = await browser.newContext()
  const user = await userCtx.newPage()
  await signIn(user, `troll${stamp}@example.com`, `Troll ${stamp}`)

  // Without the password: refused.
  const anon = await browser.newContext()
  expect((await anon.request.get('/api/admin/overview')).status()).toBe(401)
  const wrong = await browser.newContext({ httpCredentials: { username: 'admin', password: 'nope' } })
  expect((await wrong.request.get('/api/admin/overview')).status()).toBe(401)
  await anon.close()
  await wrong.close()

  // With the password: the panel works, no Google sign-in needed.
  const adminCtx = await browser.newContext({ httpCredentials: { username: 'admin', password: 'e2e-admin-password' } })
  const admin = await adminCtx.newPage()
  await admin.goto('/admin')
  const row = admin.getByRole('row', { name: new RegExp(`Troll ${stamp}`) })
  await expect(row).toBeVisible()
  // Search narrows the list; filters combine with it.
  await admin.getByTestId('user-search').fill(`troll${stamp}`)
  await expect(admin.getByRole('row')).toHaveCount(2) // header + match
  await admin.getByTestId('user-filter').selectOption('banned')
  await expect(admin.getByRole('row')).toHaveCount(1)
  await admin.getByTestId('user-filter').selectOption('all')

  admin.once('dialog', (d) => d.accept('Please stop posting fake feedback.'))
  await row.getByTestId('warn').click()
  await expect(row.getByTestId('warn-count')).toHaveText('1')

  // The user has to acknowledge the warning before using the site.
  await user.goto('/browse')
  await expect(user.getByTestId('warning-dialog')).toContainText('Please stop posting fake feedback.')
  await user.getByTestId('warning-ack').click()
  await expect(user.getByTestId('warning-dialog')).toHaveCount(0)
  await user.reload()
  await expect(user.getByText('Browse')).not.toHaveCount(0)
  await expect(user.getByTestId('warning-dialog')).toHaveCount(0)

  // Ban: signed out everywhere.
  admin.once('dialog', (d) => d.accept('Repeated fake feedback'))
  await row.getByTestId('ban').click()
  await expect(row).toContainText('Banned')
  await expect(row).toContainText('Repeated fake feedback')
  expect((await (await user.request.get('/api/me')).json()).user).toBeNull()

  await userCtx.close()
  await adminCtx.close()
})
