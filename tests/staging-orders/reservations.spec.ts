import { createStaff } from './helpers'
// Hosted writes are limited to synthetic QA tenants on the staging deployment.
import fs from 'node:fs'
import { randomUUID } from 'node:crypto'
import { parse } from 'dotenv'
import { test, expect, type BrowserContext } from '@playwright/test'
import { emptyQuotationContent } from '../../modules/sales-documents/quotation-validation'
import { json, login, type QaTenant } from './helpers'

test('hosted unit reservations: hold, allocation, release, expiry, isolation and mobile UI', async ({ browser }) => {
  expect(process.env.RUN_STAGING_ORDER_WRITES).toBe('1')
  const env = parse(fs.readFileSync('.env.new-vercel-staging'))
  expect(new URL(env.NEXTAUTH_URL).origin).toBe('https://ls-erp-staging.vercel.app')
  expect(new URL(env.SUPABASE_URL).hostname).toBe('oyhsrcmjhwxhvepdbcdc.supabase.co')
  const state = JSON.parse(fs.readFileSync('tmp/staging-setup/qa-state.json', 'utf8')) as { tenants: QaTenant[]; password: string }
  const a = state.tenants.find(t => t.origin === 'https://ls-erp-staging-qa-a.vercel.app')!, b = state.tenants.find(t => t.origin === 'https://ls-erp-staging-qa-b.vercel.app')!
  for (const tenant of [a, b]) expect(tenant.tenant.name).toMatch(/^QA Staging /)
  const contexts: BrowserContext[] = [], checks: string[] = [], ids: Record<string, string> = {}
  const open = async (origin: string, email: string, password: string, tenantId?: string) => { const c = await login(browser, origin, email, password, tenantId); contexts.push(c); return c }
  let admin: BrowserContext | undefined, enabled = false
  try {
    const platform = await open('https://ls-erp-staging.vercel.app', env.PLATFORM_ADMIN_EMAIL, env.PLATFORM_ADMIN_PASSWORD)
    admin = await open(a.origin, a.admin.email, state.password, a.tenant.id)
    const foreign = await open(b.origin, b.admin.email, state.password, b.tenant.id)
    for (const [tenant, c] of [[a, admin], [b, foreign]] as const) {
      for (const key of ['crm', 'salesDocuments', 'salesOrders', 'catalog']) {
        await json(platform, `/api/tenants/${tenant.tenant.id}/modules`, 200, 'PATCH', { key, allowed: true })
        await json(c, '/api/modules', 200, 'PATCH', { key, enabled: true })
      }
    }
    enabled = true
    const run = randomUUID().slice(0, 8), title = `QA R7.2 equipment ${run}`
    const input = { code: `QA-RES-${run}`, name: title, kind: 'UNIT', price: '100.125', currency: 'INR', unit: 'each' }
    const item = await json(admin, '/api/catalog/items', 201, 'POST', input); ids.item = item.id
    const contact = await json(admin, '/api/crm/contacts', 201, 'POST', { name: `QA reservation buyer ${run}` })
    const pipeline = await json(admin, '/api/crm/pipelines', 201, 'POST', { name: `QA reservations ${run}`, stages: [
      { name: 'Qualified', kind: 'OPEN', probability: 20, color: '#123456' }, { name: 'Won', kind: 'WON', probability: 100, color: '#228833' }, { name: 'Lost', kind: 'LOST', probability: 0, color: '#aa2233' },
    ] })
    const staffUser = (await createStaff(admin, { name: `QA reservation staff ${run}`, email: `qa-res-${run}@example.test`, role: 'STAFF', password: state.password })).user
    const staff = await open(a.origin, staffUser.email, state.password, a.tenant.id)
    const deal = await json(admin, '/api/crm/opportunities', 201, 'POST', { title, contactId: contact.id, assignedUserId: staffUser.id, pipelineId: pipeline.id, stageId: pipeline.stages.find((s: { kind: string }) => s.kind === 'OPEN').id, amount: '100.125', currency: 'INR', expectedCloseOn: '2027-12-31' })
    const content = { ...structuredClone(emptyQuotationContent), title, supplierName: 'QA Shared Industries', currency: 'INR', lines: [{ description: title, quantity: '1', unit: 'each', rate: '100.125', catalogItemId: item.id, catalogItemVersion: item.version }] }
    const quote = await json(admin, `/api/crm/opportunities/${deal.id}/quotations`, 201, 'POST', { content })
    const secondQuote = await json(admin, `/api/crm/opportunities/${deal.id}/quotations`, 201, 'POST', { content: { ...content, title: title + ' second' } })
    const first = await json(admin, '/api/sales-orders', 200, 'POST', { quotationId: quote.id, revision: 1 })
    const second = await json(admin, '/api/sales-orders', 200, 'POST', { quotationId: secondQuote.id, revision: 1 })
    ids.order = first.id; ids.second = second.id
    const path = `/api/sales-orders/${first.id}/reservations`, nextPath = `/api/sales-orders/${second.id}/reservations`
    const page = await admin.newPage(), browserErrors: string[] = []
    page.on('pageerror', error => browserErrors.push(error.message))
    await page.goto(`/sales-orders/${first.id}`)
    const section = page.getByRole('region', { name: 'Unit reservations', exact: true })
    await expect(section).toBeVisible()
    await section.getByRole('button', { name: 'Reserve unit', exact: true }).click()
    await expect(page.getByRole('dialog')).toContainText('future expiry within 30 days')
    await page.getByRole('button', { name: 'Save reservation', exact: true }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(section.getByText('Reserved', { exact: true }).first()).toBeVisible()
    const held = (await json(admin, path)).items[0]; ids.reservation = held.id
    const payload = { itemId: item.id, expiresAt: new Date(Date.now() + 86400000).toISOString() }
    const repeats = await Promise.all([json(admin, path, 200, 'POST', payload), json(admin, path, 200, 'POST', payload)])
    expect(repeats.every(r => r.id === held.id)).toBe(true)
    await json(admin, nextPath, 409, 'POST', payload)
    await json(foreign, path, 404); await json(foreign, path, 404, 'POST', payload)
    await json(staff, path, 200); await json(staff, path, 403, 'POST', payload)
    expect((await admin.request.post(path, { headers: { Origin: 'https://other.example.test' }, data: payload })).status()).toBe(403)
    await json(admin, `/api/catalog/items/${item.id}`, 409, 'PUT', { ...input, version: 1, availability: 'SOLD' })
    expect((await json(admin, `/api/catalog/items?q=${input.code}&availability=AVAILABLE`)).total).toBe(0)
    await json(admin, `${path}/${held.id}`, 409, 'PATCH', { action: 'allocate', version: 1 })
    await section.screenshot({ path: test.info().outputPath('reservation-desktop.png'), animations: 'disabled' })
    checks.push('UI hold, concurrent idempotency, competing order denial, catalog guard, tenant/staff/origin denial')
    await page.getByRole('button', { name: 'Confirm sales order', exact: true }).click()
    await page.getByRole('button', { name: 'Confirm agreement', exact: true }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await section.getByRole('button', { name: 'Allocate unit', exact: true }).click()
    await page.getByRole('button', { name: 'Confirm allocation', exact: true }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(section.getByText('Allocated', { exact: true }).first()).toBeVisible()
    expect((await json(admin, `/api/catalog/items/${item.id}`)).reservationState).toBe('ALLOCATED')
    await page.setViewportSize({ width: 390, height: 844 })
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
    await section.screenshot({ path: test.info().outputPath('allocated-mobile.png'), animations: 'disabled' })
    await section.getByRole('button', { name: 'Release unit', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Confirm release', exact: true })).toBeDisabled()
    await page.getByLabel('Release reason', { exact: true }).fill('QA customer requested another unit')
    await page.getByRole('dialog').screenshot({ path: test.info().outputPath('release-dialog-mobile.png'), animations: 'disabled' })
    await page.getByRole('button', { name: 'Confirm release', exact: true }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    expect((await json(admin, path)).items[0].status).toBe('RELEASED')
    await json(admin, `${path}/${held.id}`, 409, 'PATCH', { action: 'release', version: 2, reason: 'Stale retry' })
    const again = await json(admin, path, 200, 'POST', payload)
    await json(admin, `${path}/${again.id}`, 200, 'PATCH', { action: 'allocate', version: 1 })
    await json(admin, '/api/modules', 200, 'PATCH', { key: 'catalog', enabled: false })
    await json(admin, path, 403)
    await page.reload(); await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible()
    await expect(section).toHaveCount(0)
    await page.getByRole('button', { name: 'Cancel sales order', exact: true }).click()
    await expect(page.getByRole('dialog')).toContainText('releases any unit reservations or allocations')
    await page.getByLabel('Cancellation reason', { exact: true }).fill('QA cancellation releases allocation')
    await page.getByRole('button', { name: 'Cancel order', exact: true }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await json(admin, '/api/modules', 200, 'PATCH', { key: 'catalog', enabled: true })
    expect((await json(admin, path)).items.every((r: { status: string }) => r.status === 'RELEASED')).toBe(true)
    checks.push('Confirmed allocation, responsive UI, required release reason, disabled UI/API, atomic cancellation release')
    const short = await json(admin, nextPath, 200, 'POST', { itemId: item.id, expiresAt: new Date(Date.now() + 5000).toISOString() })
    await expect.poll(async () => (await json(admin!, nextPath)).items[0].status).toBe('EXPIRED')
    expect((await json(admin, `/api/catalog/items/${item.id}`)).reservationState).toBe(null)
    await json(admin, `${nextPath}/${short.id}`, 409, 'PATCH', { action: 'allocate', version: 1 })
    await json(admin, nextPath, 200, 'POST', payload)
    expect((await json(admin, nextPath)).items.find((r: { id: string }) => r.id === short.id).events.at(-1).status).toBe('EXPIRED')
    await page.goto(`/sales-orders/${second.id}`)
    await expect(section.getByText('Reserved', { exact: true }).first()).toBeVisible()
    await section.screenshot({ path: test.info().outputPath('expiry-history-mobile.png'), animations: 'disabled' })
    await page.goto('/catalog'); await page.getByLabel('Search catalog', { exact: true }).fill(input.code)
    await expect(page.getByRole('link', { name: input.code.toUpperCase(), exact: true })).toBeVisible()
    await expect(page.getByRole('cell', { name: 'Reserved', exact: true })).toBeVisible()
    await page.screenshot({ path: test.info().outputPath('catalog-reserved-mobile.png'), fullPage: true, animations: 'disabled' })
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
    expect(browserErrors).toEqual([])
    checks.push('Expiry immediately frees availability; reuse records expiry audit; catalog shows current reservation state')
    fs.writeFileSync('tmp/staging-setup/r72-hosted-verification.json', JSON.stringify({ at: new Date().toISOString(), origins: [a.origin, b.origin], checks, ids, browserErrors }, null, 2))
  } finally {
    if (enabled && admin) await json(admin, '/api/modules', 200, 'PATCH', { key: 'catalog', enabled: true })
    await Promise.all(contexts.map(c => c.close()))
  }
})
