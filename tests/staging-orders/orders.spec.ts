// Opt-in hosted writes, restricted to the two existing synthetic staging tenants.
// Never imports the local database fixture or accepts arbitrary target origins.
import fs from 'node:fs'
import { randomUUID } from 'node:crypto'
import { parse } from 'dotenv'
import { test, expect, type BrowserContext } from '@playwright/test'
import { emptyQuotationContent } from '../../modules/sales-documents/quotation-validation'

import { json, login, type QaTenant } from './helpers'

test('hosted Sales Orders: frozen revisions, transitions, access, module controls and responsive UI', async ({ browser }) => {
  expect(process.env.RUN_STAGING_ORDER_WRITES).toBe('1')
  const env = parse(fs.readFileSync('.env.new-vercel-staging'))
  expect(new URL(env.NEXTAUTH_URL).origin).toBe('https://ls-erp-staging.vercel.app')
  expect(new URL(env.SUPABASE_URL).hostname).toBe('oyhsrcmjhwxhvepdbcdc.supabase.co')
  const state = JSON.parse(fs.readFileSync('tmp/staging-setup/qa-state.json', 'utf8')) as { tenants: QaTenant[]; password: string }
  const a = state.tenants.find(t => t.origin === 'https://ls-erp-staging-qa-a.vercel.app')!
  const b = state.tenants.find(t => t.origin === 'https://ls-erp-staging-qa-b.vercel.app')!
  for (const t of [a, b]) expect(t.tenant.name).toMatch(/^QA Staging /)
  const contexts: BrowserContext[] = [], checks: string[] = [], ids: Record<string, string> = {}
  const open = async (origin: string, email: string, password: string, tenantId?: string) => { const c = await login(browser, origin, email, password, tenantId); contexts.push(c); return c }
  let admin: BrowserContext | undefined
  let modulesActivated = false, restoreReceivables = false
  try {
    const platform = await open('https://ls-erp-staging.vercel.app', env.PLATFORM_ADMIN_EMAIL, env.PLATFORM_ADMIN_PASSWORD)
    admin = await open(a.origin, a.admin.email, state.password, a.tenant.id)
    const foreign = await open(b.origin, b.admin.email, state.password, b.tenant.id)
    const tenants = await json(platform, '/api/tenants?pageSize=100')
    expect(JSON.stringify(tenants)).toContain(a.tenant.id)
    for (const [t, c] of [[a, admin], [b, foreign]] as const) {
      const before = await json(c, '/api/modules')
      for (const key of ['crm', 'salesDocuments']) expect(before.modules.find((m: { key: string }) => m.key === key)?.enabled).toBe(true)
      await json(platform, `/api/tenants/${t.tenant.id}/modules`, 200, 'PATCH', { key: 'salesOrders', allowed: true })
      await json(c, '/api/modules', 200, 'PATCH', { key: 'salesOrders', enabled: true })
    }
    modulesActivated = true
    checks.push('Platform allowance and tenant activation succeed on both QA tenants')
    const run = randomUUID().slice(0, 8), title = `QA R7 support ${run}`
    const contact = await json(admin, '/api/crm/contacts', 201, 'POST', { name: `QA R7 customer ${run}` })
    const pipeline = await json(admin, '/api/crm/pipelines', 201, 'POST', { name: `QA R7 pipeline ${run}`, stages: [
      { name: 'Qualified', kind: 'OPEN', probability: 20, color: '#123456' },
      { name: 'Won', kind: 'WON', probability: 100, color: '#228833' },
      { name: 'Lost', kind: 'LOST', probability: 0, color: '#aa2233' },
    ] })
    const staffUser = (await json(admin, '/api/users', 200, 'POST', { name: `QA R7 staff ${run}`, email: `qa-r7-staff-${run}@example.test`, role: 'STAFF', password: state.password })).user
    const staff = await open(a.origin, staffUser.email, state.password, a.tenant.id)
    const deal = await json(admin, '/api/crm/opportunities', 201, 'POST', { title, contactId: contact.id, assignedUserId: staffUser.id, pipelineId: pipeline.id, stageId: pipeline.stages.find((s: { kind: string }) => s.kind === 'OPEN').id, amount: '300.38', currency: 'INR', expectedCloseOn: '2027-12-31' })
    const content = { ...structuredClone(emptyQuotationContent), title, supplierName: 'QA Shared Industries', currency: 'INR', lines: [{ description: 'Support hours', quantity: '3', unit: 'hour', rate: '100.125' }], terms: 'QA agreed terms v1' }
    const quote = await json(admin, `/api/crm/opportunities/${deal.id}/quotations`, 201, 'POST', { content })
    ids.quotation = quote.id; ids.opportunity = deal.id
    const original = await json(admin, `/api/crm/quotations/${quote.id}?revision=1`)
    const page = await admin.newPage(), browserErrors: string[] = []
    page.on('pageerror', e => browserErrors.push(e.message))
    await page.goto(`/crm/quotations/${quote.id}`)
    await page.getByRole('button', { name: 'Create sales order', exact: true }).click()
    await expect(page).toHaveURL(/\/sales-orders\/[^/]+$/)
    const id = page.url().split('/').pop()!; ids.order = id
    await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible()
    const draft = await json(admin, `/api/sales-orders/${id}`)
    expect(draft.status).toBe('DRAFT'); expect(draft.snapshot).toEqual(original.snapshot)
    await page.screenshot({ path: test.info().outputPath('draft-desktop.png'), fullPage: true })
    checks.push('UI creates a draft from the exact saved quotation snapshot')
    const duplicate = await Promise.all([json(admin, '/api/sales-orders', 200, 'POST', { quotationId: quote.id, revision: 1 }), json(admin, '/api/sales-orders', 200, 'POST', { quotationId: quote.id, revision: 1 })])
    expect(duplicate.map(o => o.id)).toEqual([id, id])
    const revised = { ...content, title: title + ' revised', terms: 'QA changed terms v2', lines: [{ description: 'Replacement service', quantity: '1', unit: 'hour', rate: '999' }] }
    await json(admin, `/api/crm/quotations/${quote.id}`, 200, 'PUT', { content: revised, version: 1 })
    expect((await json(admin, `/api/sales-orders/${id}`)).snapshot).toEqual(original.snapshot)
    await json(admin, '/api/sales-orders', 409, 'POST', { quotationId: quote.id, revision: 2 })
    checks.push('Concurrent duplicate requests reuse one order; new quote revisions preserve terms and conflict while active')
    await json(foreign, `/api/sales-orders/${id}`, 404)
    expect((await json(foreign, '/api/sales-orders?q=' + id)).total).toBe(0)
    await json(foreign, '/api/sales-orders', 404, 'POST', { quotationId: quote.id, revision: 1 })
    await json(staff, `/api/sales-orders/${id}`)
    await json(staff, `/api/sales-orders/${id}`, 403, 'PATCH', { action: 'confirm', version: 1 })
    checks.push('Foreign tenant cannot read/create; assigned staff can read but cannot confirm')
    const cross = await admin.request.patch(`/api/sales-orders/${id}`, { headers: { Origin: 'https://other.example.test' }, data: { action: 'confirm', version: 1 } })
    expect(cross.status()).toBe(403)
    await page.getByRole('button', { name: 'Confirm sales order', exact: true }).click()
    await expect(page.getByRole('dialog')).toContainText('does not reserve stock or property')
    await page.getByRole('button', { name: 'Confirm agreement', exact: true }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Confirm sales order', exact: true })).toHaveCount(0)
    const confirmed = await json(admin, `/api/sales-orders/${id}`)
    expect(confirmed.status).toBe('CONFIRMED'); expect(confirmed.version).toBe(2)
    await json(admin, `/api/sales-orders/${id}`, 409, 'PATCH', { action: 'cancel', version: 1, reason: 'Stale edit' })
    await json(admin, `/api/sales-orders/${id}`, 400, 'PATCH', { action: 'cancel', version: 2, reason: ' ' })
    await page.setViewportSize({ width: 390, height: 844 })
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
    await page.screenshot({ path: test.info().outputPath('confirmed-mobile.png'), fullPage: true })
    await page.getByRole('button', { name: 'Cancel sales order', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Cancel order', exact: true })).toBeDisabled()
    await page.getByLabel('Cancellation reason', { exact: true }).fill('QA customer requested revised terms')
    await expect.poll(() => page.getByRole('dialog').evaluate(el => getComputedStyle(el).opacity)).toBe('1')
    await page.screenshot({ path: test.info().outputPath('cancel-dialog-mobile.png'), animations: 'disabled' })
    await page.getByRole('button', { name: 'Cancel order', exact: true }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(page.getByText('QA customer requested revised terms', { exact: true })).toBeVisible()
    const cancelled = await json(admin, `/api/sales-orders/${id}`)
    expect(cancelled.status).toBe('CANCELLED'); expect(cancelled.history.map((e: { status: string }) => e.status)).toEqual(['DRAFT', 'CONFIRMED', 'CANCELLED'])
    await json(admin, `/api/sales-orders/${id}`, 409, 'PATCH', { action: 'confirm', version: 3 })
    const replacement = await json(admin, '/api/sales-orders', 200, 'POST', { quotationId: quote.id, revision: 2 })
    ids.replacement = replacement.id; expect(replacement.id).not.toBe(id); expect(replacement.revision).toBe(2)
    checks.push('UI confirms and cancels with reason/history; stale writes and invalid transitions rejected; replacement uses v2')
    const testUser = (await json(admin, '/api/users', 200, 'POST', { name: `QA R7 manager ${run}`, email: `qa-r7-manager-${run}@example.test`, role: 'MANAGER', password: state.password })).user
    const role = await json(admin, '/api/access/roles', 201, 'POST', { name: `QA R7 reader ${run}`, permissions: ['salesOrders.read'], salesRecordScope: 'ALL' })
    await json(admin, `/api/access/users/${testUser.id}`, 200, 'PATCH', { roleId: role.id, previousRoleId: null })
    const manager = await open(a.origin, testUser.email, state.password, a.tenant.id)
    expect((await json(manager, `/api/sales-orders/${replacement.id}`)).canConfirm).toBe(false)
    await json(manager, `/api/sales-orders/${replacement.id}`, 403, 'PATCH', { action: 'confirm', version: 1 })
    await json(manager, '/api/sales-orders', 403, 'POST', { quotationId: quote.id, revision: 2 })
    await json(admin, `/api/access/roles/${role.id}`, 200, 'PATCH', { name: role.name, version: role.version, permissions: ['salesOrders.read', 'salesOrders.confirm'], salesRecordScope: 'ALL' })
    await json(manager, `/api/sales-orders/${replacement.id}`, 200, 'PATCH', { action: 'confirm', version: 1 })
    await json(manager, `/api/sales-orders/${replacement.id}`, 403, 'PATCH', { action: 'cancel', version: 2, reason: 'No cancel permission' })
    checks.push('Custom manager role requires distinct create/confirm/cancel permissions and refreshes immediately')
    await json(admin, '/api/modules', 409, 'PATCH', { key: 'salesDocuments', enabled: false })
    restoreReceivables = (await json(admin, '/api/modules')).modules.some((m: { key: string; enabled: boolean }) => m.key === 'receivables' && m.enabled)
    if (restoreReceivables) {
      await json(admin, '/api/modules', 409, 'PATCH', { key: 'salesOrders', enabled: false })
      await json(admin, '/api/modules', 200, 'PATCH', { key: 'receivables', enabled: false })
    }
    await json(admin, '/api/modules', 200, 'PATCH', { key: 'salesOrders', enabled: false })
    await json(admin, `/api/sales-orders/${id}`, 403)
    await page.goto(`/crm/quotations/${quote.id}`)
    await expect(page.getByRole('heading', { name: new RegExp(title) })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Create sales order', exact: true })).toHaveCount(0)
    await page.goto('/sales-orders')
    await expect(page.getByRole('heading', { name: 'Module unavailable', exact: true })).toBeVisible()
    await json(admin, '/api/modules', 200, 'PATCH', { key: 'salesOrders', enabled: true })
    await page.goto('/sales-orders')
    await page.getByLabel('Search orders', { exact: true }).fill(run)
    await expect(page.getByRole('link', { name: title, exact: true })).toBeVisible()
    await expect(page.getByRole('link', { name: title + ' revised', exact: true })).toBeVisible()
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
    await page.screenshot({ path: test.info().outputPath('list-mobile.png'), fullPage: true })
    await page.setViewportSize({ width: 1280, height: 900 })
    await page.screenshot({ path: test.info().outputPath('list-desktop.png'), fullPage: true })
    expect(browserErrors).toEqual([])
    checks.push('Dependencies protect activation; disabled module blocks API/UI; desktop/mobile layouts fit without page overflow')
    fs.writeFileSync('tmp/staging-setup/r7-hosted-verification.json', JSON.stringify({ at: new Date().toISOString(), origins: [a.origin, b.origin], checks, ids, browserErrors }, null, 2))
  } finally {
    if (modulesActivated && admin) await json(admin, '/api/modules', 200, 'PATCH', { key: 'salesOrders', enabled: true })
    if (restoreReceivables && admin) await json(admin, '/api/modules', 200, 'PATCH', { key: 'receivables', enabled: true })
    await Promise.all(contexts.map(c => c.close()))
  }
})
