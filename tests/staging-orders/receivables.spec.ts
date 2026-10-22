// Writes only synthetic QA tenants on the explicitly allowlisted staging app.
import fs from 'node:fs'
import { randomUUID } from 'node:crypto'
import { parse } from 'dotenv'
import { test, expect, type BrowserContext } from '@playwright/test'
import { emptyQuotationContent } from '../../modules/sales-documents/quotation-validation'
import { json, login, type QaTenant } from './helpers'

test('hosted receivables: schedule, payments, reversals, isolation and mobile UI', async ({ browser }) => {
  expect(process.env.RUN_STAGING_ORDER_WRITES).toBe('1')
  const env = parse(fs.readFileSync('.env.new-vercel-staging'))
  expect(new URL(env.NEXTAUTH_URL).origin).toBe('https://ls-erp-staging.vercel.app')
  expect(new URL(env.SUPABASE_URL).hostname).toBe('oyhsrcmjhwxhvepdbcdc.supabase.co')
  const state = JSON.parse(fs.readFileSync('tmp/staging-setup/qa-state.json', 'utf8')) as { tenants: QaTenant[]; password: string }
  const a = state.tenants.find(t => t.origin === 'https://ls-erp-staging-qa-a.vercel.app')!, b = state.tenants.find(t => t.origin === 'https://ls-erp-staging-qa-b.vercel.app')!
  for (const tenant of [a, b]) expect(tenant.tenant.name).toMatch(/^QA Staging /)
  const contexts: BrowserContext[] = [], checks: string[] = []
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
    const run = randomUUID().slice(0, 8), title = `QA R7.3 service contract ${run}`
    const contact = await json(admin, '/api/crm/contacts', 201, 'POST', { name: `QA payments buyer ${run}` })
    const pipeline = await json(admin, '/api/crm/pipelines', 201, 'POST', { name: `QA payments ${run}`, stages: [
      { name: 'Qualified', kind: 'OPEN', probability: 20, color: '#123456' }, { name: 'Won', kind: 'WON', probability: 100, color: '#228833' }, { name: 'Lost', kind: 'LOST', probability: 0, color: '#aa2233' },
    ] })
    const staffUser = (await json(admin, '/api/users', 200, 'POST', { name: `QA payments staff ${run}`, email: `qa-pay-${run}@example.test`, role: 'STAFF', password: state.password })).user
    const staff = await open(a.origin, staffUser.email, state.password, a.tenant.id)
    const deal = await json(admin, '/api/crm/opportunities', 201, 'POST', { title, contactId: contact.id, assignedUserId: staffUser.id, pipelineId: pipeline.id, stageId: pipeline.stages.find((s: { kind: string }) => s.kind === 'OPEN').id, amount: '100', currency: 'INR', expectedCloseOn: '2027-12-31' })
    const quote = await json(admin, `/api/crm/opportunities/${deal.id}/quotations`, 201, 'POST', { content: { ...structuredClone(emptyQuotationContent), title, supplierName: 'QA Shared Industries', currency: 'INR', lines: [{ description: 'Support service', quantity: '1', unit: 'contract', rate: '100' }], charges: [{ label: 'Setup', kind: 'FIXED', value: '20', basis: 'BASE', included: false, due: '', group: '' }] } })
    const order = await json(admin, '/api/sales-orders', 200, 'POST', { quotationId: quote.id, revision: 1 })
    await json(admin, `/api/sales-orders/${order.id}`, 200, 'PATCH', { action: 'confirm', version: 1 })
    const path = `/api/sales-orders/${order.id}/receivables`, page = await admin.newPage(), browserErrors: string[] = []
    page.on('pageerror', error => browserErrors.push(error.message))
    await page.goto(`/sales-orders/${order.id}`)
    const section = page.getByRole('region', { name: 'Receivables', exact: true })
    await section.getByRole('button', { name: 'Open receivables', exact: true }).click()
    await page.getByLabel('Order consideration · INR 100.00', { exact: true }).fill('2026-01-01')
    await page.getByRole('button', { name: 'Confirm schedule', exact: true }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(section).toContainText('Unscheduled')
    let current = await json(admin, path)
    expect(current.account.total).toBe('120'); expect(current.overdue).toBe('100')
    await section.getByRole('button', { name: 'Record payment', exact: true }).click()
    await page.getByLabel('Amount (INR)', { exact: true }).fill('40')
    await page.getByLabel('Payment date', { exact: true }).fill('2026-01-02')
    await page.getByLabel('Payment reference', { exact: true }).fill(`QA-${run}`)
    await page.getByRole('button', { name: 'Save payment', exact: true }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    current = await json(admin, path); expect(current.paid).toBe('40'); expect(current.outstanding).toBe('80'); expect(current.overdue).toBe('60')
    const payment = current.items[0]
    const payload = { requestKey: randomUUID(), version: 2, amount: '90', receivedOn: '2026-01-02', method: 'CASH', reference: '', note: '' }
    await json(admin, `${path}/payments`, 409, 'POST', payload)
    await json(foreign, path, 404); await json(staff, `${path}/payments`, 403, 'POST', payload)
    expect((await admin.request.post(`${path}/payments`, { headers: { Origin: 'https://other.example.test' }, data: payload })).status()).toBe(403)
    await json(admin, `/api/sales-orders/${order.id}`, 409, 'PATCH', { action: 'cancel', version: 2, reason: 'Unresolved payment' })
    await section.screenshot({ path: test.info().outputPath('receivables-desktop.png'), animations: 'disabled' })
    await page.setViewportSize({ width: 390, height: 844 })
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
    await section.screenshot({ path: test.info().outputPath('receivables-mobile.png'), animations: 'disabled' })
    await section.getByRole('button', { name: 'Correct or refund', exact: true }).click()
    await page.getByLabel('Reason', { exact: true }).fill('QA duplicate entry correction')
    await page.getByRole('dialog').screenshot({ path: test.info().outputPath('reversal-mobile.png'), animations: 'disabled' })
    await page.getByRole('button', { name: 'Confirm reversal', exact: true }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(section).toContainText('Entry corrected')
    current = await json(admin, path); expect(current.outstanding).toBe('120')
    const full = { ...payload, version: 3, amount: '120', requestKey: randomUUID() }
    const paid = await json(admin, `${path}/payments`, 200, 'POST', full)
    expect((await json(admin, `${path}/payments`, 200, 'POST', full)).id).toBe(paid.id)
    expect((await json(admin, path)).outstanding).toBe('0')
    await json(admin, `${path}/payments/${paid.id}/reverse`, 200, 'POST', { requestKey: randomUUID(), version: 4, kind: 'REFUND', reason: 'QA full refund already paid', effectiveOn: '2026-01-03', reference: `REFUND-${run}` })
    await json(admin, '/api/modules', 200, 'PATCH', { key: 'receivables', enabled: false })
    await json(admin, path, 403); await page.reload(); await expect(section).toHaveCount(0)
    await json(admin, '/api/modules', 200, 'PATCH', { key: 'receivables', enabled: true })
    await json(admin, `/api/sales-orders/${order.id}`, 200, 'PATCH', { action: 'cancel', version: 2, reason: 'QA refund complete' })
    current = await json(admin, path); expect(current.status).toBe('CANCELLED'); expect(current.outstanding).toBe('0'); expect(current.items).toHaveLength(2)
    expect(browserErrors).toEqual([])
    checks.push('UI schedule and partial payment, extra charges, overdue, full settlement, correction and full refund', 'overpayment, idempotency, cancellation guard, module gate, tenant/staff/origin denial', 'desktop and mobile screenshots, no horizontal document overflow or browser errors')
    fs.writeFileSync('tmp/staging-setup/r73-hosted-verification.json', JSON.stringify({ at: new Date().toISOString(), tenantId: a.tenant.id, orderId: order.id, paymentId: payment.id, refundedPaymentId: paid.id, checks }, null, 2))
  } finally {
    if (admin) await json(admin, '/api/modules', 200, 'PATCH', { key: 'receivables', enabled: true }).catch(() => {})
    await Promise.all(contexts.map(c => c.close()))
  }
})
