/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict')
const { Client } = require('pg')
const { request, chromium } = require('playwright')
const { configuration } = require('./local-demo.cjs')
const { root } = require('./database-workflow.cjs')
async function main() {
  const config = configuration(), directory = path.join(root, 'tmp/local-demo')
  const state = JSON.parse(fs.readFileSync(path.join(directory, 'data.json')))
  assert(state.complete, 'Start local:demo and let sample creation complete first.')
  const through = new Intl.DateTimeFormat('en-CA', { timeZone: state.records.display.timeZone }).format(new Date(state.createdAt))
  const from = new Date(Date.parse(through + 'T12:00:00Z') - 86400000).toISOString().slice(0, 10)
  const period = `&from=${from}&through=${through}`
  const sessions = [], origin = 'http://demo.localhost:3109'
  let browser
  async function login(email, baseURL = origin) {
    const api = await request.newContext({ baseURL, timeout: 120000 }); sessions.push(api)
    const csrf = await (await api.get('/api/auth/csrf')).json()
    await api.post('/api/auth/callback/credentials', { form: { csrfToken: csrf.csrfToken, email, password: config.values.DEMO_PASSWORD, callbackUrl: baseURL + '/dashboard' } })
    assert.equal((await (await api.get('/api/auth/session')).json()).user?.email, email)
    return api
  }
  async function get(api, route, status = 200) { const response = await api.get(route); assert.equal(response.status(), status, route); return response.json() }
  try {
    const admin = await login('admin@demo.test'), manager = await login('manager@demo.test'), regional = await login('regional@demo.test'), staff = await login('staff1@demo.test'), isolation = await login('admin@isolation.test', 'http://isolation.localhost:3109')
    const all = await get(admin, '/api/crm/reports/sales/team?scope=team&pageSize=100' + period)
    assert.equal(all.totals.enquiries, 40); assert.equal(all.totals.converted, 9)
    assert.equal(all.totals.pipeline, 4); assert.equal(all.totals.won, 4); assert.equal(all.totals.lost, 4)
    assert.equal(all.totals.callsCompleted, 24); assert.equal(all.totals.activitiesOpen, 12)
    assert.equal(all.items.find(item => item.id === state.records['user:staff4'].id).enquiries, 0)
    const north = state.records['team:North'].id, south = state.records['team:South'].id
    const managed = await get(manager, `/api/crm/reports/sales/team?scope=team&salesTeamId=${north}${period}`)
    assert.equal(managed.totals.enquiries, 27)
    await get(manager, `/api/crm/reports/sales/team?scope=team&salesTeamId=${south}`, 403)
    assert.equal((await get(regional, `/api/crm/reports/sales/team?scope=team&salesTeamId=${south}${period}`)).totals.enquiries, 13)
    await get(staff, '/api/crm/reports/sales/team?scope=team', 403)
    assert.equal((await get(staff, '/api/crm/enquiries?pageSize=100')).total, 14)
    await get(isolation, `/api/crm/enquiries/${state.records['enquiry:0'].id}`, 404)
    assert.equal((await get(isolation, '/api/crm/enquiries')).total, 0)
    const db = new Client({ connectionString: config.values.DATABASE_URL }); await db.connect()
    try {
      const role = (await db.query('SELECT rolsuper,rolbypassrls,rolcreatedb,rolcreaterole FROM pg_roles WHERE rolname=current_user')).rows[0]
      assert(Object.values(role).every(value => value === false))
      assert.equal((await db.query('SELECT count(*)::int n FROM "CrmEnquiry"')).rows[0].n, 0, 'Unscoped runtime reads must not expose business records')
    } finally { await db.end() }
    browser = await chromium.launch({ channel: 'chrome', headless: true })
    const context = await browser.newContext({ baseURL: origin, storageState: await admin.storageState(), viewport: { width: 1440, height: 1000 } })
    const page = await context.newPage(), errors = []; page.setDefaultTimeout(60000)
    page.on('pageerror', error => errors.push(error.message))
    await page.goto('/crm/sales?view=team', { waitUntil: 'domcontentloaded', timeout: 120000 })
    await page.getByRole('heading', { name: 'Team insights', exact: true }).waitFor()
    await page.getByRole('region', { name: 'Enquiry status mix', exact: true }).screenshot({ path: path.join(directory, 'charts-desktop.png'), animations: 'disabled' })
    await page.setViewportSize({ width: 390, height: 844 })
    assert(!await page.evaluate(() => document.documentElement.scrollWidth > innerWidth))
    await page.getByRole('region', { name: 'Enquiry status mix', exact: true }).screenshot({ path: path.join(directory, 'charts-mobile.png'), animations: 'disabled' })
    assert.deepEqual(errors, [])
    await context.close()
    await require('./local-demo-data.cjs').seed(config)
    assert.equal((await get(admin, '/api/crm/enquiries')).total, 40)
    fs.writeFileSync(path.join(directory, 'verification.json'), JSON.stringify({ at: new Date().toISOString(), passed: true, enquiries: 40, opportunities: 12, activities: 36, managerTeamBoundary: true, multiTeamManager: true, staffBoundary: true, crossTenantDenied: true, runtimeRlsEnforced: true, existingDemoPreserved: true, chartBrowserErrors: 0, mobileOverflow: false }, null, 2))
    console.log('Local demo verification passed: counts, manager/team scopes, staff/cross-tenant denial, native RLS, charts, mobile layout and repeat-start preservation.')
  } finally { for (const api of sessions) await api.dispose(); if (browser) await browser.close() }
}
main().catch(error => { console.error(error.message.replace(/postgres(?:ql)?:\/\/\S+/g, '[database URL]')); process.exitCode = 1 })
