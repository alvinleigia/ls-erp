import { expect, type BrowserContext, type Browser } from '@playwright/test'
export type QaTenant = { origin: string; tenant: { id: string; name: string }; admin: { email: string } }
export async function json(c: BrowserContext, path: string, status = 200, method = 'GET', data?: unknown) {
  const r = await c.request.fetch(path, { method, ...(data === undefined ? {} : { data }) })
  expect(r.status(), `${method} ${path}: ${await r.text()}`).toBe(status)
  return r.json()
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
