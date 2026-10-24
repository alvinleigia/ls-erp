import fs from 'node:fs'
import { randomUUID } from 'node:crypto'
import { parse } from 'dotenv'
import { test, expect } from '@playwright/test'
import { json, login, type QaTenant } from './helpers'

test('hosted team intake: flexible default, both paths, explicit restrictions and tenant isolation', async ({ browser }, info) => {
  expect(process.env.RUN_STAGING_ORDER_WRITES).toBe('1')
  const env = parse(fs.readFileSync('.env.new-vercel-staging'))
  expect(new URL(env.NEXTAUTH_URL).origin).toBe('https://ls-erp-staging.vercel.app')
  expect(new URL(env.SUPABASE_URL).hostname).toBe('oyhsrcmjhwxhvepdbcdc.supabase.co')
  const state = JSON.parse(fs.readFileSync('tmp/staging-setup/qa-state.json', 'utf8')) as { tenants: QaTenant[]; password: string }
  const a = state.tenants.find(t => t.origin === 'https://ls-erp-staging-qa-a.vercel.app')!
  const b = state.tenants.find(t => t.origin === 'https://ls-erp-staging-qa-b.vercel.app')!
  for (const t of [a, b]) expect(t.tenant.name).toMatch(/^QA Staging /)
  const admin = await login(browser, a.origin, a.admin.email, state.password, a.tenant.id)
  const foreign = await login(browser, b.origin, b.admin.email, state.password, b.tenant.id)
  const run = randomUUID().slice(0, 8), page = await admin.newPage(), errors: string[] = []
  page.on('pageerror', e => errors.push(e.message))
  try {
    const session = await json(admin, '/api/auth/session')
    const name = `QA R8 Flexible team ${run}`
    await page.goto(a.origin + '/crm/configuration/sales-teams/new')
    await page.getByLabel('Team name', { exact: true }).fill(name)
    await expect(page.getByLabel('Sales workflow', { exact: true })).toHaveText('Enquiries and direct opportunities')
    await page.getByRole('button', { name: 'Save sales team', exact: true }).click()
    await expect(page).toHaveURL(/\/sales-teams\/(?!new)[^/]+$/)
    const id = page.url().split('/').at(-1)!
    let team = await json(admin, `/api/crm/sales-teams/${id}`)
    expect(team.workflow).toBe('BOTH')
    team = await json(admin, `/api/crm/sales-teams/${id}/members`, 200, 'POST', { version: team.version, userId: session.user.id })
    const contact = await json(admin, '/api/crm/contacts', 201, 'POST', { name: `QA R8 buyer ${run}` })
    const pipeline = await json(admin, '/api/crm/pipelines', 201, 'POST', { name: `QA R8 pipeline ${run}`, stages: [{ name: 'Open', kind: 'OPEN', probability: 10, color: '#2563eb' }, { name: 'Won', kind: 'WON', probability: 100, color: '#00aa00' }, { name: 'Lost', kind: 'LOST', probability: 0, color: '#aa0000' }] })
    const leadInput = { title: `QA R8 enquiry ${run}`, salesTeamId: id, contactId: contact.id, assignedUserId: session.user.id }
    const dealInput = { ...leadInput, title: `QA R8 direct deal ${run}`, pipelineId: pipeline.id, stageId: pipeline.stages.find((s: { kind: string }) => s.kind === 'OPEN').id, amount: '100', currency: 'INR', expectedCloseOn: '2026-12-31' }
    const direct = await json(admin, '/api/crm/opportunities', 201, 'POST', dealInput)
    const lead = await json(admin, '/api/crm/enquiries', 201, 'POST', leadInput)
    expect(lead.status).toBe('NEW')
    const converted = await json(admin, '/api/crm/opportunities', 201, 'POST', { ...dealInput, enquiryId: lead.id, enquiryVersion: lead.version })
    expect(converted.enquiryId).toBe(lead.id)
    await json(foreign, `/api/crm/sales-teams/${id}`, 404)
    await json(foreign, `/api/crm/opportunities/${direct.id}`, 404)
    await page.goto(a.origin + `/crm/configuration/sales-teams/${id}`)
    const dialog = page.getByRole('dialog')
    await page.getByRole('button', { name: 'Edit team details', exact: true }).click()
    await dialog.getByLabel('Sales workflow', { exact: true }).click()
    await page.screenshot({ path: info.outputPath('team-workflow-desktop.png'), fullPage: true, animations: 'disabled' })
    await page.getByRole('menuitemradio', { name: 'Qualify enquiries first', exact: true }).click()
    await dialog.getByRole('button', { name: 'Save changes', exact: true }).click()
    await expect(dialog).toHaveCount(0)
    await json(admin, '/api/crm/opportunities', 400, 'POST', dealInput)
    const unqualified = await json(admin, '/api/crm/enquiries', 201, 'POST', leadInput)
    await json(admin, '/api/crm/opportunities', 400, 'POST', { ...dealInput, enquiryId: unqualified.id })
    const qualified = await json(admin, `/api/crm/enquiries/${unqualified.id}`, 200, 'PATCH', { title: unqualified.title, assignedUserId: session.user.id, status: 'QUALIFIED', version: unqualified.version })
    await json(admin, '/api/crm/opportunities', 201, 'POST', { ...dealInput, enquiryId: unqualified.id, enquiryVersion: qualified.version })
    await page.getByRole('button', { name: 'Edit team details', exact: true }).click()
    await dialog.getByLabel('Sales workflow', { exact: true }).click()
    await page.getByRole('menuitemradio', { name: 'Direct opportunities only', exact: true }).click()
    await dialog.getByRole('button', { name: 'Save changes', exact: true }).click()
    await expect(dialog).toHaveCount(0)
    await json(admin, '/api/crm/enquiries', 400, 'POST', leadInput)
    await json(admin, '/api/crm/opportunities', 201, 'POST', dealInput)
    await page.setViewportSize({ width: 390, height: 844 })
    await page.getByRole('button', { name: 'Edit team details', exact: true }).click()
    await dialog.getByLabel('Sales workflow', { exact: true }).click()
    await page.screenshot({ path: info.outputPath('team-workflow-mobile.png'), fullPage: true, animations: 'disabled' })
    await page.getByRole('menuitemradio', { name: 'Enquiries and direct opportunities', exact: true }).click()
    await dialog.getByRole('button', { name: 'Save changes', exact: true }).click()
    await expect(dialog).toHaveCount(0)
    expect((await json(admin, `/api/crm/sales-teams/${id}`)).workflow).toBe('BOTH')
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    expect(errors).toEqual([])
    fs.writeFileSync('tmp/staging-setup/r8-hosted-verification.json', JSON.stringify({ at: new Date().toISOString(), tenantId: a.tenant.id, teamId: id, directId: direct.id, leadId: lead.id, convertedId: converted.id, passed: true, checks: ['new team default and both intake paths', 'qualification and direct-only enforcement', 'existing records retained and tenant isolation', 'desktop/mobile UI and no page errors'] }, null, 2))
  } finally { await Promise.all([admin.close(), foreign.close()]) }
})
