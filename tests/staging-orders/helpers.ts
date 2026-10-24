import { expect, type BrowserContext, type Browser } from '@playwright/test'
export type QaTenant = { origin: string; tenant: { id: string; name: string }; admin: { email: string } }
export async function json(c: BrowserContext, path: string, status = 200, method = 'GET', data?: unknown) {
  const r = await c.request.fetch(path, { method, ...(data === undefined ? {} : { data }) })
  expect(r.status(), `${method} ${path}: ${await r.text()}`).toBe(status)
  return r.json()
}
export async function assignProfiles(c: BrowserContext, userId: string, roleIds: string[], scopes: { salesRecordScope?: string; projectRecordScope?: string } = {}) {
  const current = await json(c, `/api/access/users/${userId}`)
  return json(c, `/api/access/users/${userId}`, 200, 'PATCH', { roleIds, version: current.accessPolicy.version, salesRecordScope: current.accessPolicy.salesRecordScope, projectRecordScope: current.accessPolicy.projectRecordScope, ...scopes })
}
export async function login(browser: Browser, origin: string, email: string, password: string, tenantId?: string) {
  expect(['https://ls-erp-staging.vercel.app', 'https://ls-erp-staging-qa-a.vercel.app', 'https://ls-erp-staging-qa-b.vercel.app']).toContain(origin)
  const c = await browser.newContext({ baseURL: origin })
  const csrf = await json(c, '/api/auth/csrf')
  await c.request.post('/api/auth/callback/credentials', { form: { csrfToken: csrf.csrfToken, email, password, callbackUrl: origin + '/dashboard' } })
  const session = await json(c, '/api/auth/session')
  expect(session.user?.email).toBe(email)
  if (tenantId) expect(session.user.tenantId).toBe(tenantId)
  return c
}
