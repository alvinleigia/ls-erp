import { test, expect } from '@playwright/test'
import sharp from 'sharp'
import { seed, login, json } from './fixtures'

test('tenant branding settings save, persist and respect permissions on desktop and mobile', async ({ browser }) => {
  const f = await seed(), admin = await login(browser, f.origin, f.users.admin.email)
  try {
    const page = admin.page
    await page.goto('/settings/branding')
    await expect(page.getByRole('heading', { name: 'Branding', exact: true })).toBeVisible()
    await expect(page.getByLabel('Upload logo', { exact: true })).toBeDisabled()
    await page.getByLabel('Business display name', { exact: true }).fill('QA Shared Industries')
    await page.getByRole('button', { name: 'Save branding', exact: true }).click()
    await expect(page.getByText('Branding saved.', { exact: true })).toBeVisible()
    await page.reload()
    await expect(page.getByLabel('Business display name', { exact: true })).toHaveValue('QA Shared Industries')
    const image = await sharp({create:{width:1200,height:400,channels:4,background:{r:0,g:80,b:150,alpha:.5}}}).png().toBuffer()
    const preview = await admin.context.request.post('/api/settings/branding/preview', { multipart: { logo: { name: 'logo.png', mimeType: 'image/png', buffer: image } } })
    expect(preview.status()).toBe(200); expect((await preview.json()).width).toBe(1200)
    await page.screenshot({ path: test.info().outputPath('branding-desktop.png'), fullPage: true })
    await page.setViewportSize({width:390,height:844})
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
    await page.screenshot({ path: test.info().outputPath('branding-mobile.png'), fullPage: true })
    const staff = await login(browser, f.origin, f.users.staff.email)
    try {
      await staff.page.goto('/settings/branding')
      await expect(staff.page.getByRole('heading', {name:'Access unavailable'})).toBeVisible()
      expect((await staff.context.request.post('/api/settings/branding/preview', { multipart: { logo: { name: 'logo.png', mimeType: 'image/png', buffer: image } } })).status()).toBe(403)
    } finally { await staff.context.close() }
    const other = await login(browser, `http://${f.otherSlug}.localhost:3108`, f.users.other.email)
    try { expect((await json(other.context, '/api/settings/branding')).branding.name).toBeUndefined() } finally { await other.context.close() }
  } finally { await admin.context.close(); await f.db.end() }
})
