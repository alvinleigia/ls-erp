import fs from 'node:fs'
import { randomUUID } from 'node:crypto'
import { parse } from 'dotenv'
import { test, expect, type BrowserContext } from '@playwright/test'
import { emptyQuotationContent } from '../../modules/sales-documents/quotation-validation'
import { json, login, type QaTenant } from './helpers'

test('hosted receivables overview: currency totals, filters, paging, scope and responsive UI', async ({ browser }) => {
  expect(process.env.RUN_STAGING_ORDER_WRITES).toBe('1')
  const env = parse(fs.readFileSync('.env.new-vercel-staging'))
  expect(new URL(env.NEXTAUTH_URL).origin).toBe('https://ls-erp-staging.vercel.app')
  expect(new URL(env.SUPABASE_URL).hostname).toBe('oyhsrcmjhwxhvepdbcdc.supabase.co')
  const state = JSON.parse(fs.readFileSync('tmp/staging-setup/qa-state.json', 'utf8')) as { tenants: QaTenant[]; password: string }
  const a = state.tenants.find(t => t.origin === 'https://ls-erp-staging-qa-a.vercel.app')!, b = state.tenants.find(t => t.origin === 'https://ls-erp-staging-qa-b.vercel.app')!
  for (const tenant of [a, b]) expect(tenant.tenant.name).toMatch(/^QA Staging /)
  const contexts: BrowserContext[] = []
  const open = async (origin: string, email: string, password: string, tenantId?: string) => { const c = await login(browser, origin, email, password, tenantId); contexts.push(c); return c }
  let admin: BrowserContext | undefined
  try {
    const platform = await open('https://ls-erp-staging.vercel.app', env.PLATFORM_ADMIN_EMAIL, env.PLATFORM_ADMIN_PASSWORD)
    admin = await open(a.origin, a.admin.email, state.password, a.tenant.id)
    const foreign = await open(b.origin, b.admin.email, state.password, b.tenant.id)
    for (const [tenant, c] of [[a, admin], [b, foreign]] as const) for (const key of ['crm', 'salesDocuments', 'salesOrders', 'receivables']) {
      await json(platform, `/api/tenants/${tenant.tenant.id}/modules`, 200, 'PATCH', { key, allowed: true })
      await json(c, '/api/modules', 200, 'PATCH', { key, enabled: true })
    }
    const run = randomUUID().slice(0, 8), title = `QA R7.4 ${run}`
    const contact = await json(admin, '/api/crm/contacts', 201, 'POST', { name: `QA overview buyer ${run}` })
    const pipeline = await json(admin, '/api/crm/pipelines', 201, 'POST', { name: title, stages: [
      { name: 'Qualified', kind: 'OPEN', probability: 20, color: '#123456' }, { name: 'Won', kind: 'WON', probability: 100, color: '#228833' }, { name: 'Lost', kind: 'LOST', probability: 0, color: '#aa2233' },
    ] })
    const session = await json(admin, '/api/auth/session')
    const deal = await json(admin, '/api/crm/opportunities', 201, 'POST', { title, contactId: contact.id, assignedUserId: session.user.id, pipelineId: pipeline.id, stageId: pipeline.stages.find((s: { kind: string }) => s.kind === 'OPEN').id, amount: '100', currency: 'INR', expectedCloseOn: '2027-12-31' })
    const make = async (label: string, currency: string, amount: string, due: string | null, payment?: string) => {
      const quote = await json(admin!, `/api/crm/opportunities/${deal.id}/quotations`, 201, 'POST', { content: { ...structuredClone(emptyQuotationContent), title: title + label, supplierName: 'QA Shared Industries', currency, lines: [{ description: 'Service contract', quantity: '1', unit: 'contract', rate: amount }] } })
      const order = await json(admin!, '/api/sales-orders', 200, 'POST', { quotationId: quote.id, revision: 1 })
      await json(admin!, `/api/sales-orders/${order.id}`, 200, 'PATCH', { action: 'confirm', version: 1 })
      const path = `/api/sales-orders/${order.id}/receivables`
      await json(admin!, path, 200, 'POST', { dueDates: [due] })
      if (payment) await json(admin!, `${path}/payments`, 200, 'POST', { requestKey: randomUUID(), version: 1, amount: payment, receivedOn: '2026-01-01', method: 'CASH', reference: '', note: 'QA overview payment' })
      return order.id
    }
    const overdueId = await make(' overdue', 'INR', '100', '2026-01-01', '40')
    await make(' unscheduled', 'JPY', '200', null)
    await make(' settled', 'INR', '9', null, '9')
    const path = `/api/receivables?q=${encodeURIComponent(title)}`
    const result = await json(admin, path + '&pageSize=1')
    expect(result.total).toBe(2); expect(result.items).toHaveLength(1); expect(result.summaries.find((s: { currency: string }) => s.currency === 'INR').outstanding).toBe('60')
    expect(result.summaries.find((s: { currency: string }) => s.currency === 'JPY').unscheduled).toBe('200')
    expect((await json(admin, path + '&page=2&pageSize=1')).summaries).toEqual(result.summaries)
    expect((await json(foreign, path)).total).toBe(0)
    expect((await json(admin, path + '&status=SETTLED')).items[0].outstanding).toBe('0')
    const page = await admin.newPage(), browserErrors: string[] = []
    page.on('pageerror', e => browserErrors.push(e.message))
    await page.goto('/sales-orders/receivables')
    await page.getByLabel('Search receivables').fill(title)
    const inr = page.getByRole('region', { name: 'INR balances', exact: true }), yen = page.getByRole('region', { name: 'JPY balances', exact: true })
    await expect(inr).toContainText('INR 60.00'); await expect(yen).toContainText('JPY 200')
    await expect(page.getByRole('link', { name: title + ' settled', exact: true })).toHaveCount(0)
    await page.screenshot({ path: test.info().outputPath('overview-desktop.png'), fullPage: true, animations: 'disabled' })
    await page.getByRole('button', { name: 'Balance status', exact: true }).click()
    await page.getByRole('menuitemradio', { name: 'Overdue', exact: true }).click()
    await expect(yen).toHaveCount(0); await expect(inr).toContainText('INR 60.00')
    await page.setViewportSize({ width: 390, height: 844 })
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
    await page.screenshot({ path: test.info().outputPath('overview-mobile.png'), fullPage: true, animations: 'disabled' })
    await page.getByRole('link', { name: title + ' overdue', exact: true }).click()
    await expect(page).toHaveURL(new RegExp(`/sales-orders/${overdueId}$`))
    await expect(page.getByRole('region', { name: 'Receivables', exact: true })).toContainText('INR 60.00')
    const user = (await json(admin, '/api/users', 200, 'POST', { name: `QA overview manager ${run}`, email: `qa-overview-${run}@example.test`, role: 'MANAGER', password: state.password })).user
    const role = await json(admin, '/api/access/roles', 201, 'POST', { name: `QA own balances ${run}`, permissions: ['salesOrders.read', 'receivables.read'], salesRecordScope: 'OWN' })
    await json(admin, `/api/access/users/${user.id}`, 200, 'PATCH', { roleId: role.id, previousRoleId: null })
    const manager = await open(a.origin, user.email, state.password, a.tenant.id)
    const denied = await json(manager, path); expect(denied.total).toBe(0); expect(denied.summaries).toEqual([]); expect(denied.currencies).toEqual([])
    const updated = await json(admin, `/api/access/roles/${role.id}`, 200, 'PATCH', { name: role.name, version: role.version, permissions: ['salesOrders.read', 'receivables.read'], salesRecordScope: 'ALL' })
    expect((await json(manager, path)).total).toBe(2)
    await json(admin, `/api/access/roles/${role.id}`, 200, 'PATCH', { name: role.name, version: updated.version, permissions: ['salesOrders.read'], salesRecordScope: 'ALL' })
    await json(manager, path, 403)
    await json(admin, '/api/modules', 200, 'PATCH', { key: 'receivables', enabled: false })
    await json(admin, path, 403); await page.goto('/sales-orders/receivables'); await expect(page.getByRole('heading', { name: 'Module unavailable' })).toBeVisible()
    expect(browserErrors).toEqual([])
    fs.writeFileSync('tmp/staging-setup/r74-hosted-verification.json', JSON.stringify({ at: new Date().toISOString(), orderId: overdueId, tenantId: a.tenant.id, checks: ['currency separation and pagination totals', 'overdue/settled filters and detail navigation', 'tenant, own scope, fresh role and module denials', 'desktop/mobile screenshots and no page overflow or browser errors'] }, null, 2))
  } finally {
    if (admin) await json(admin, '/api/modules', 200, 'PATCH', { key: 'receivables', enabled: true })
    await Promise.all(contexts.map(c => c.close()))
  }
})
