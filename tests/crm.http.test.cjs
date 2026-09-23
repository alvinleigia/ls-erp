/* eslint-disable @typescript-eslint/no-require-imports */
// Run only against the isolated server and synthetic crm-demo fixture described
// in docs/MODULAR_PLATFORM.md. This exercises real authentication and HTTP routes.
const { test } = require("node:test")
const assert = require("node:assert/strict")
const origin = process.env.CRM_TEST_HTTP_ORIGIN
if (origin !== "http://127.0.0.1:3107") throw new Error("CRM_TEST_HTTP_ORIGIN must be the isolated server at http://127.0.0.1:3107")
const host = "crm-demo.localhost:3107"
function session() {
  const cookies = new Map()
  return async function request(path, options = {}) {
    const response = await fetch(`${origin}${path}`, {
      redirect: "manual", ...options,
      headers: { host, "x-forwarded-host": host, cookie: [...cookies].map(([key, value]) => `${key}=${value}`).join("; "), ...options.headers },
    })
    for (const header of response.headers.getSetCookie()) {
      const cookie = header.split(";")[0]
      const index = cookie.indexOf("=")
      cookies.set(cookie.slice(0, index), cookie.slice(index + 1))
    }
    return response
  }
}
async function login(email) {
  const request = session()
  const csrf = await (await request("/api/auth/csrf")).json()
  const response = await request("/api/auth/callback/credentials", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", "X-Auth-Return-Redirect": "1" },
    body: new URLSearchParams({ csrfToken: csrf.csrfToken, email, password: "LocalCrmTest!2026", callbackUrl: `http://${host}/crm/enquiries` }),
  })
  assert.equal(response.status, 200, "Credentials callback failed")
  const authenticated = await (await request("/api/auth/session")).json()
  assert.equal(authenticated.user?.email, email, "Test session did not authenticate")
  return request
}
const json = (method, data) => ({ method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) })

test("real HTTP authentication, module access and complete CRM workflow", async () => {
  assert.equal((await session()("/api/crm/contacts")).status, 401)
  const admin = await login("admin@crm-demo.test")
  const salesperson = await login("sales@crm-demo.test")
  assert.equal((await salesperson("/api/modules", json("PATCH", { key: "crm", enabled: true }))).status, 403)
  assert.equal((await admin("/api/modules", json("PATCH", { key: "crm", enabled: false }))).status, 200)
  assert.equal((await admin("/api/crm/contacts")).status, 403)
  assert.equal((await admin("/api/modules", json("PATCH", { key: "crm", enabled: true }))).status, 200)
  assert.equal((await admin("/api/crm/contacts", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{" })).status, 400)
  const created = await admin("/api/crm/contacts", json("POST", { name: "HTTP workflow buyer" }))
  assert.equal(created.status, 201)
  const contact = await created.json()
  const assignees = await (await admin("/api/crm/assignees?q=Salesperson")).json()
  const salespersonId = assignees.items[0].id
  const response = await admin("/api/crm/enquiries", json("POST", { contactId: contact.id, assignedUserId: salespersonId, title: "HTTP property enquiry" }))
  assert.equal(response.status, 201)
  const enquiry = await response.json()
  assert.equal((await salesperson(`/api/crm/enquiries/${enquiry.id}`)).status, 200)
  assert.equal((await salesperson(`/api/crm/enquiries/${enquiry.id}/activity`, json("POST", { message: "Called and captured requirements." }))).status, 201)
  const taskResponse = await salesperson(`/api/crm/enquiries/${enquiry.id}/tasks`, json("POST", { title: "Arrange viewing", dueOn: "2026-09-25" }))
  assert.equal(taskResponse.status, 201)
  const task = await taskResponse.json()
  assert.equal((await salesperson(`/api/crm/tasks/${task.id}`, json("PATCH", { completed: true }))).status, 200)
  assert.equal((await salesperson(`/api/crm/enquiries/${enquiry.id}`, json("PATCH", { title: enquiry.title, assignedUserId: salespersonId, status: "CLOSED", outcome: "Visit arranged", version: enquiry.version }))).status, 200)
  const history = await (await salesperson(`/api/crm/enquiries/${enquiry.id}/activity`)).json()
  assert.equal(history.total, 5)
  for (const path of ["/crm/contacts", "/crm/contacts/new", `/crm/contacts/${contact.id}`, "/crm/enquiries", "/crm/enquiries/new", `/crm/enquiries/${enquiry.id}`, "/crm/tasks", "/settings/modules", "/appointments"]) {
    const page = await admin(path)
    assert.equal(page.status, 200, `Page failed: ${path}`)
    const html = await page.text()
    assert.ok(!html.includes("NEXT_HTTP_ERROR_FALLBACK;500"), `Server rendering failed: ${path}`)
  }
})
