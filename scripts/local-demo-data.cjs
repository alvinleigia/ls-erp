/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('node:fs'), path = require('node:path')
const { request } = require('playwright')
const { root, localUrl } = require('./database-workflow.cjs')
const file = path.join(root, 'tmp/local-demo/data.json')
const origin = 'http://demo.localhost:3109'
async function seed(config) {
  localUrl(config.values.DIRECT_URL)
  const state = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file)) : { version: 1, records: {} }
  if (state.version !== 1 || state.inFlight) throw Error('Local demo setup was interrupted. Inspect tmp/local-demo/data.json before resuming; no automatic duplicate retry was attempted.')
  if (state.complete) { console.log('Existing local demo preserved; sample data was not recreated.'); return }
  require('../tests/register.cjs')
  const { moduleProfileTemplates } = require('../platform/access/profiles.ts')
  const { defaultRecordRules, supportedScopes } = require('../platform/access/rules.ts')
  const save = () => fs.writeFileSync(file, JSON.stringify(state, null, 2), { mode: 0o600 })
  async function once(key, operation) {
    if (state.records[key]) return state.records[key]
    state.inFlight = key; save()
    const result = await operation()
    state.records[key] = result; delete state.inFlight; save()
    return result
  }
  async function login(baseURL, email) {
    const api = await request.newContext({ baseURL, timeout: 120000 })
    const csrf = await (await api.get('/api/auth/csrf')).json()
    await api.post('/api/auth/callback/credentials', { form: { csrfToken: csrf.csrfToken, email, password: config.values.DEMO_PASSWORD, callbackUrl: baseURL + '/dashboard' } })
    const session = await (await api.get('/api/auth/session')).json()
    if (session.user?.email !== email) { await api.dispose(); throw Error('Local demo login failed.') }
    return api
  }
  async function json(api, url, method = 'GET', data) {
    let headers = {}
    if (method === 'POST' && /^\/api\/crm\/(enquiries|opportunities|work)$/.test(url)) {
      const workspace = await json(api, '/api/workspace/office')
      headers = { 'x-office-id': workspace.creationOffice.id, 'x-office-version': String(workspace.version) }
    }
    const response = await api.fetch(url, { method, headers, ...(data ? { data } : {}) })
    if (!response.ok()) {
      if (response.status() < 500) { delete state.inFlight; save() }
      const result = await response.json().catch(() => ({}))
      throw Error(`Local demo API ${method} ${url} failed (${response.status()}): ${result.error || 'request rejected'}`)
    }
    return response.json()
  }
  const platform = await login('http://platform.localhost:3109', 'platform@local-demo.test')
  let admin
  try {
    for (const slug of ['demo', 'isolation']) await once(`tenant:${slug}`, () => json(platform, '/api/tenants', 'POST', { name: slug === 'demo' ? 'Local Demo Business' : 'Local Isolation Business', slug, adminName: slug === 'demo' ? 'Demo Admin' : 'Isolation Admin', adminEmail: `admin@${slug}.test`, adminPassword: config.values.DEMO_PASSWORD, modules: ['crm', 'salesDocuments', 'paymentPlans', 'realEstate', 'inventory', 'services', 'appointments', 'leaves', 'shifts'] }))
    admin = await login(origin, 'admin@demo.test')
    const office = (await json(admin, '/api/offices')).items[0]
    await once('display', async () => {
      // Preserve existing settings once initialized; tenant dates drive sample dates.
      const settings = await json(admin, '/api/settings/display')
      return { timeZone: settings.settings?.timeZone || 'UTC' }
    })
    const profile = await once('crm-profile', () => json(admin, '/api/access/roles', 'POST', { name: 'Demo CRM access', moduleKey: 'crm', permissions: moduleProfileTemplates.find(item => item.key === 'crm:manager').permissions }))
    const staffProfile = await once('staff-profile', () => json(admin, '/api/access/roles', 'POST', { name: 'Demo salesperson', moduleKey: 'crm', permissions: moduleProfileTemplates.find(item => item.key === 'crm:manager').permissions.filter(permission => permission.endsWith('.read') || ['contacts', 'accounts', 'enquiries', 'opportunities', 'activities'].includes(permission.split('.')[0])) }))
    const directory = await once('directory-profile', () => json(admin, '/api/access/roles', 'POST', { name: 'Demo workspace viewer', moduleKey: 'core', permissions: moduleProfileTemplates.find(item => item.key === 'core:viewer').permissions }))
    for (const key of ['manager', 'regional', 'staff1', 'staff2', 'staff3', 'staff4']) {
      const manager = ['manager', 'regional'].includes(key), rules = defaultRecordRules()
      for (const permission of Object.keys(rules)) {
        const resource = permission.split('.')[0]
        if (manager && supportedScopes(resource).includes('MANAGED_TEAMS')) rules[permission] = 'MANAGED_TEAMS'
        if (resource === 'reports') rules[permission] = manager ? 'ALL' : 'OWN'
      }
      await once(`user:${key}`, async () => (await json(admin, '/api/users', 'POST', { name: { manager: 'North Manager', regional: 'Regional Manager', staff1: 'Alex Sales', staff2: 'Blair Sales', staff3: 'Casey Sales', staff4: 'Drew Sales (zero work)' }[key], email: `${key}@demo.test`, role: manager ? 'MANAGER' : 'STAFF', password: config.values.DEMO_PASSWORD, accessRoleIds: [manager ? profile.id : staffProfile.id, directory.id], recordRules: rules, officeAccess: { officeIds: [office.id], companies: [], creationOfficeId: office.id } })).user)
    }
    const users = Object.fromEntries(['manager', 'regional', 'staff1', 'staff2', 'staff3', 'staff4'].map(key => [key, state.records[`user:${key}`]]))
    for (const [name, members] of [['North', ['manager', 'regional', 'staff1', 'staff2']], ['South', ['regional', 'staff3', 'staff4']]]) {
      const team = await once(`team:${name}`, () => json(admin, '/api/teams', 'POST', { name: `${name} Sales` }))
      for (const key of members) await once(`member:${name}:${key}`, async () => {
        const current = await json(admin, `/api/teams/${team.id}`)
        await json(admin, `/api/teams/${team.id}/members`, 'POST', { version: current.version, userId: users[key].id, isManager: ['manager', 'regional'].includes(key) })
        return { added: true }
      })
    }
    const source = await once('source', () => json(admin, '/api/crm/lead-sources', 'POST', { name: 'Demo Website' }))
    const reason = await once('lost-reason', () => json(admin, '/api/crm/lost-reasons', 'POST', { name: 'Budget mismatch' }))
    const pipeline = await once('pipeline', () => json(admin, '/api/crm/pipelines', 'POST', { name: 'Demo Sales', stages: [{ name: 'New opportunity', kind: 'OPEN', probability: 10, color: '#2563eb' }, { name: 'Proposal', kind: 'OPEN', probability: 50, color: '#d97706' }, { name: 'Won', kind: 'WON', probability: 100, color: '#0d9488' }, { name: 'Lost', kind: 'LOST', probability: 0, color: '#dc2626' }] }))
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: state.records.display.timeZone }).format(new Date())
    const day = offset => new Date(Date.parse(today + 'T12:00:00Z') + offset * 86400000).toISOString().slice(0, 10)
    for (let i = 0; i < 40; i++) {
      const who = ['staff1', 'staff2', 'staff3'][i % 3], team = state.records[`team:${who === 'staff3' ? 'South' : 'North'}`]
      const contact = await once(`contact:${i}`, () => json(admin, '/api/crm/contacts', 'POST', { name: `Demo Customer ${String(i + 1).padStart(2, '0')}`, email: `customer${i + 1}@demo-customer.test` }))
      const input = { title: `Demo enquiry ${String(i + 1).padStart(2, '0')}`, contactId: contact.id, assignedUserId: users[who].id, salesTeamId: team.id, sourceId: source.id }
      const lead = await once(`enquiry:${i}`, () => json(admin, '/api/crm/enquiries', 'POST', input))
      const edit = { ...input }; delete edit.contactId
      if (i % 4 !== 0) await once(`status:${i}`, () => json(admin, `/api/crm/enquiries/${lead.id}`, 'PATCH', { ...edit, version: lead.version, status: ['NEW', 'CONTACTED', 'QUALIFIED', 'CLOSED'][i % 4], ...(i % 4 === 3 ? { lostReasonId: reason.id, outcome: 'Demo budget mismatch' } : {}) }))
      if (i < 12) {
        const deal = await once(`opportunity:${i}`, () => json(admin, '/api/crm/opportunities', 'POST', { title: `Demo opportunity ${i + 1}`, contactId: contact.id, assignedUserId: users[who].id, salesTeamId: team.id, pipelineId: pipeline.id, stageId: pipeline.stages[0].id, amount: String((i + 1) * 15000), currency: i % 4 === 0 ? 'USD' : 'INR', expectedCloseOn: day(20), ...(i % 4 !== 3 ? { enquiryId: lead.id, enquiryVersion: (state.records[`status:${i}`] || lead).version } : {}) }))
        if (i % 3 !== 0) await once(`deal-stage:${i}`, () => json(admin, `/api/crm/opportunities/${deal.id}/move`, 'PATCH', { pipelineId: pipeline.id, stageId: pipeline.stages.find(stage => stage.kind === (i % 3 === 1 ? 'WON' : 'LOST')).id, version: deal.version, ...(i % 3 === 2 ? { lostReasonId: reason.id, lossReason: 'Demo budget mismatch' } : {}) }))
        for (let n = 0; n < 3; n++) await once(`work:${i}:${n}`, () => json(admin, '/api/crm/work', 'POST', { title: `Demo ${n === 2 ? 'follow-up' : 'call'} ${i + 1}.${n + 1}`, contactId: contact.id, opportunityId: deal.id, assignedUserId: users[who].id, type: n === 2 ? 'TASK' : 'CALL', ...(n !== 2 ? { callDirection: 'OUTBOUND' } : {}), dueOn: day(n === 2 ? i % 2 ? -3 : 2 : -1), ...(n !== 2 ? { completion: { summary: 'Synthetic local demo call', outcome: ['CONNECTED', 'NO_ANSWER', 'BUSY', 'VOICEMAIL', 'WRONG_NUMBER', 'NOT_INTERESTED'][(i + n) % 6], occurredAt: new Date(Date.now() - 3600000).toISOString() } } : {}) }))
      }
    }
    state.complete = true; state.createdAt = new Date().toISOString(); save()
    console.log('Local demo created: two businesses, two sales teams, two managers, four staff, 40 enquiries, 12 opportunities and 36 activities.')
  } finally { await platform.dispose(); if (admin) await admin.dispose() }
}
module.exports = { seed }
