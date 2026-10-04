/* eslint-disable @typescript-eslint/no-require-imports */
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { NextRequest } = require('next/server')

process.env.APP_ROOT_DOMAIN = 'leiwissen.leigia.com'
process.env.PLATFORM_ADMIN_TENANT_SLUG = 'platform'
// Keep the real routing guard; authentication itself is covered by login tests.
const authPath = require.resolve('../auth.ts')
require.cache[authPath] = { id: authPath, filename: authPath, loaded: true, exports: { auth: handler => handler } }
const guard = require('../proxy.ts').default

function request(path, { host = 'leiwissen.leigia.com', role = 'ADMIN' } = {}) {
  const req = new NextRequest(`https://${host}${path}`, { headers: { host, 'x-forwarded-host': host } })
  req.auth = role ? { user: { role } } : null
  return req
}

test('platform administrator can reach tenant and organization console routes', () => {
  for (const path of ['/api/tenants', '/api/tenants/example/modules', '/api/organizations?pageSize=100', '/api/organizations/example/members', '/settings/tenants', '/settings/organizations', '/api/auth/session']) {
    const result = guard(request(path))
    assert.equal(result.headers.get('x-middleware-next'), '1', path)
  }
})

test('platform administrator remains blocked from business APIs and lookalike paths', async () => {
  for (const path of ['/api/crm/contacts', '/api/settings', '/api/users', '/api/organizations-other', '/api/tenants-other']) {
    const result = guard(request(path))
    assert.equal(result.status, 403, path)
    assert.deepEqual(await result.json(), { error: 'Forbidden.' })
  }
  for (const path of ['/dashboard', '/crm/contacts', '/settings/roles', '/settings/organizations-other']) {
    const result = guard(request(path))
    assert.equal(new URL(result.headers.get('location')).pathname, '/settings/tenants', path)
  }
})

test('business tenant and unauthenticated requests retain their downstream authorization', () => {
  for (const options of [{ host: 'client.leiwissen.leigia.com' }, { role: 'STAFF' }, { role: null }]) {
    assert.equal(guard(request('/api/organizations', options)).headers.get('x-middleware-next'), '1')
  }
  assert.equal(guard(request('/api/crm/contacts', { host: 'client.leiwissen.leigia.com' })).headers.get('x-middleware-next'), '1')
})
