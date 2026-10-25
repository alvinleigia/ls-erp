import { createStaff } from './helpers'
import fs from 'node:fs'
import { randomUUID } from 'node:crypto'
import { parse } from 'dotenv'
import { test, expect, type BrowserContext } from '@playwright/test'
import { emptyQuotationContent } from '../../modules/sales-documents/quotation-validation'
import { json, login, type QaTenant } from './helpers'

test('hosted collection follow-ups: scheduling, outcomes, linked next step, access and responsive UI', async ({ browser }) => {
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
    const run = randomUUID().slice(0, 8), title = `QA R7.5 ${run}`, userId = (await json(admin, '/api/auth/session')).user.id
    const contact = await json(admin, '/api/crm/contacts', 201, 'POST', { name: `QA collection buyer ${run}` })
    const pipeline = await json(admin, '/api/crm/pipelines', 201, 'POST', { name: title, stages: [
      { name: 'Qualified', kind: 'OPEN', probability: 20, color: '#123456' }, { name: 'Won', kind: 'WON', probability: 100, color: '#228833' }, { name: 'Lost', kind: 'LOST', probability: 0, color: '#aa2233' },
    ] })
    const deal = await json(admin, '/api/crm/opportunities', 201, 'POST', { title, contactId: contact.id, assignedUserId: userId, pipelineId: pipeline.id, stageId: pipeline.stages.find((s: { kind: string }) => s.kind === 'OPEN').id, amount: '100', currency: 'INR', expectedCloseOn: '2027-12-31' })
    const quote = await json(admin, `/api/crm/opportunities/${deal.id}/quotations`, 201, 'POST', { content: { ...structuredClone(emptyQuotationContent), title, supplierName: 'QA Shared Industries', currency: 'INR', lines: [{ description: 'Service contract', quantity: '1', unit: 'contract', rate: '100' }] } })
    const order = await json(admin, '/api/sales-orders', 200, 'POST', { quotationId: quote.id, revision: 1 })
    await json(admin, `/api/sales-orders/${order.id}`, 200, 'PATCH', { action: 'confirm', version: 1 })
    const path = `/api/sales-orders/${order.id}/receivables`, listPath = `/api/crm/work?collectionOrderId=${order.id}&scope=visible`
    await json(admin, path, 200, 'POST', { dueDates: ['2026-01-01'] })
    const page = await admin.newPage(), errors: string[] = []
    page.on('pageerror', e => errors.push(e.message))
    await page.goto(`/sales-orders/${order.id}`)
    const panel = page.getByRole('region', { name: 'Collection follow-ups', exact: true })
    await expect(panel).toContainText('No pending collection follow-ups.')
    await panel.getByRole('button', { name: 'Schedule collection follow-up', exact: true }).click()
    await page.getByLabel('Activity title', { exact: true }).fill(title + ' call')
    await page.getByLabel('Due date', { exact: true }).fill('2026-10-24')
    await page.getByRole('dialog').screenshot({ path: test.info().outputPath('follow-up-form-desktop.png'), animations: 'disabled' })
    await page.setViewportSize({ width: 390, height: 844 })
    await page.getByRole('dialog').screenshot({ path: test.info().outputPath('follow-up-form-mobile.png'), animations: 'disabled' })
    await page.getByRole('button', { name: 'Save follow-up', exact: true }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(panel.getByRole('link', { name: title + ' call', exact: true })).toBeVisible()
    const task = (await json(admin, listPath)).items[0]
    expect(task.collectionOrderId).toBe(order.id)
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
    await panel.screenshot({ path: test.info().outputPath('follow-ups-mobile.png'), animations: 'disabled' })
    await page.setViewportSize({ width: 1440, height: 1000 })
    await page.getByRole('region', { name: 'Receivables', exact: true }).screenshot({ path: test.info().outputPath('follow-ups-desktop.png'), animations: 'disabled' })
    await panel.getByRole('link', { name: title + ' call', exact: true }).click()
    await page.getByRole('button', { name: 'Record outcome', exact: true }).click()
    await page.getByRole('button', { name: 'Outcome', exact: true }).click()
    await page.getByRole('menuitemradio', { name: 'CONNECTED', exact: true }).click()
    await page.getByLabel('Customer interaction summary', { exact: true }).fill('QA customer requested another call. No payment received.')
    await page.getByLabel('Schedule a manual follow-up', { exact: true }).check()
    await page.locator('#next-title').fill(title + ' next')
    await page.getByRole('button', { name: 'Complete and schedule next', exact: true }).click()
    await expect(page.getByText('Recorded outcome: CONNECTED', { exact: true })).toBeVisible()
    await json(admin, `/api/crm/work/${task.id}/history`, 201, 'POST', { message: 'QA internal collection note.' })
    const next = (await json(admin, listPath)).items[0]
    expect(next.followUpOfId).toBe(task.id); expect(next.collectionOrderId).toBe(order.id)
    expect((await json(admin, path)).outstanding).toBe('100')
    await json(foreign, path + '/follow-ups', 404); await json(foreign, listPath, 404)
    const user = (await createStaff(admin, { name: `QA collection staff ${run}`, email: `qa-collection-${run}@example.test`, role: 'STAFF', password: state.password })).user
    const assigned = await json(admin, '/api/crm/work', 201, 'POST', { collectionOrderId: order.id, contactId: contact.id, opportunityId: deal.id, title: title + ' assigned', type: 'CALL', callDirection: 'OUTBOUND', assignedUserId: user.id, dueOn: '2026-10-24' })
    const staff = await open(a.origin, user.email, state.password, a.tenant.id)
    expect((await json(staff, `/api/crm/work/${assigned.id}`)).id).toBe(assigned.id)
    await json(staff, path, 404); await json(staff, path + '/follow-ups', 404)
    await json(admin, `${path}/payments`, 200, 'POST', { requestKey: randomUUID(), version: 1, amount: '100', receivedOn: '2026-01-01', method: 'CASH', reference: '', note: 'QA settlement' })
    expect((await json(admin, path + '/follow-ups')).canCreate).toBe(false)
    await page.goto(`/sales-orders/${order.id}`)
    await expect(panel.getByRole('link', { name: title + ' next' })).toBeVisible()
    await expect(panel.getByRole('button', { name: 'Schedule collection follow-up', exact: true })).toHaveCount(0)
    await json(admin, '/api/modules', 200, 'PATCH', { key: 'receivables', enabled: false })
    await json(admin, path + '/follow-ups', 403); await page.reload(); await expect(panel).toHaveCount(0)
    expect(errors).toEqual([])
    fs.writeFileSync('tmp/staging-setup/r75-hosted-verification.json', JSON.stringify({ at: new Date().toISOString(), tenantId: a.tenant.id, orderId: order.id, taskId: task.id, nextTaskId: next.id, assignedTaskId: assigned.id, checks: ['UI scheduling and completion with linked next step', 'notes, immutable balance and settlement visibility', 'tenant/scope/module denials and separate assignee financial access', 'desktop/mobile screenshots, no page overflow or browser errors'] }, null, 2))
  } finally {
    if (admin) await json(admin, '/api/modules', 200, 'PATCH', { key: 'receivables', enabled: true })
    await Promise.all(contexts.map(c => c.close()))
  }
})
