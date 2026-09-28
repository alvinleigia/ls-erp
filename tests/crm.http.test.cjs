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
  assert.equal((await session()("/api/crm/reports/activities")).status, 401)
  assert.equal((await session()("/api/crm/activity-plans")).status, 401)
  const admin = await login("admin@crm-demo.test")
  const salesperson = await login("sales@crm-demo.test")
  assert.equal((await salesperson("/api/modules", json("PATCH", { key: "crm", enabled: true }))).status, 403)
  assert.equal((await admin("/api/modules", json("PATCH", { key: "crm", enabled: false }))).status, 200)
  assert.equal((await admin("/api/crm/contacts")).status, 403)
  assert.equal((await admin("/api/modules", json("PATCH", { key: "crm", enabled: true }))).status, 200)
  const reasonResponse = await admin("/api/crm/lost-reasons", json("POST", { name: `HTTP budget mismatch ${Date.now()}` }))
  assert.equal(reasonResponse.status, 201)
  const lostReason = await reasonResponse.json()
  assert.equal((await salesperson("/api/crm/lost-reasons", json("POST", { name: "Not allowed" }))).status, 403)
  assert.equal((await admin("/api/crm/contacts", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{" })).status, 400)
  const created = await admin("/api/crm/contacts", json("POST", { name: "HTTP workflow buyer" }))
  assert.equal(created.status, 201)
  const contact = await created.json()
  const accountResponse = await admin("/api/crm/accounts", json("POST", { name: "HTTP Business", website: "https://example.test" }))
  assert.equal(accountResponse.status, 201)
  const account = await accountResponse.json()
  assert.equal((await salesperson(`/api/crm/accounts/${account.id}`)).status, 404)
  assert.equal((await admin(`/api/crm/contacts/${contact.id}/accounts`, json("POST", { accountId: account.id }))).status, 200)
  const assignees = await (await admin("/api/crm/assignees?q=Salesperson")).json()
  const salespersonId = assignees.items[0].id
  const response = await admin("/api/crm/enquiries", json("POST", { contactId: contact.id, assignedUserId: salespersonId, title: "HTTP property enquiry" }))
  assert.equal(response.status, 201)
  const enquiry = await response.json()
  assert.equal((await salesperson(`/api/crm/enquiries/${enquiry.id}`)).status, 200)
  assert.equal((await salesperson(`/api/crm/accounts/${account.id}`)).status, 200)
  assert.equal((await salesperson(`/api/crm/contacts/${contact.id}/accounts/${account.id}`, { method: "DELETE" })).status, 404)
  assert.equal((await (await salesperson(`/api/crm/accounts/${account.id}/contacts`)).json()).total, 1)
  assert.equal((await salesperson(`/api/crm/enquiries/${enquiry.id}/activity`, json("POST", { message: "Called and captured requirements." }))).status, 201)
  const taskResponse = await salesperson(`/api/crm/enquiries/${enquiry.id}/tasks`, json("POST", { title: "Arrange viewing", dueOn: "2026-09-25" }))
  assert.equal(taskResponse.status, 201)
  const task = await taskResponse.json()
  assert.equal((await salesperson(`/api/crm/tasks/${task.id}`, json("PATCH", { completed: true }))).status, 200)
  assert.equal((await salesperson(`/api/crm/enquiries/${enquiry.id}`, json("PATCH", { title: enquiry.title, assignedUserId: salespersonId, status: "CLOSED", outcome: "Budget too low", lostReasonId: lostReason.id, version: enquiry.version }))).status, 200)
  const history = await (await salesperson(`/api/crm/enquiries/${enquiry.id}/activity`)).json()
  assert.equal(history.total, 6) // creation, assignment, note, task creation/completion, closing
  assert.ok(history.items.some(item => item.message.includes(`Lost reason: ${lostReason.name}`)))
  const pipelineInput = { name: "HTTP Sales", stages: [
    { name: "Qualify", kind: "OPEN", probability: 20, color: "#123456" },
    { name: "Won", kind: "WON", probability: 100, color: "#16a34a" },
    { name: "Lost", kind: "LOST", probability: 0, color: "#dc2626" },
  ] }
  assert.equal((await session()("/api/crm/opportunities")).status, 401)
  assert.equal((await salesperson("/api/crm/pipelines", json("POST", pipelineInput))).status, 403)
  const pipelineResponse = await admin("/api/crm/pipelines", json("POST", pipelineInput))
  assert.equal(pipelineResponse.status, 201)
  const pipeline = await pipelineResponse.json()
  const source = await (await admin("/api/crm/enquiries", json("POST", { contactId: contact.id, title: "Conversion enquiry", assignedUserId: salespersonId }))).json()
  const dealInput = { title: "HTTP Opportunity", contactId: contact.id, enquiryId: source.id, assignedUserId: salespersonId, pipelineId: pipeline.id, stageId: pipeline.stages[0].id, amount: "123456.7891", currency: "INR", expectedCloseOn: "2026-12-01" }
  const opportunityResponse = await salesperson("/api/crm/opportunities", json("POST", dealInput))
  assert.equal(opportunityResponse.status, 201)
  const deal = await opportunityResponse.json()
  assert.equal((await (await salesperson("/api/crm/reports/follow-up-gaps")).json()).items[0].id, deal.id)
  assert.equal(deal.amount, "123456.7891")
  assert.equal((await (await salesperson("/api/crm/opportunities", json("POST", dealInput))).json()).id, deal.id)
  assert.equal((await (await salesperson(`/api/crm/enquiries/${source.id}`)).json()).opportunity.id, deal.id)
  const loss = { pipelineId: pipeline.id, stageId: pipeline.stages[2].id, version: 1 }
  assert.equal((await salesperson(`/api/crm/opportunities/${deal.id}/move`, json("PATCH", loss))).status, 400)
  assert.equal((await salesperson(`/api/crm/opportunities/${deal.id}/move`, json("PATCH", { ...loss, lossReason: "Budget postponed", lostReasonId: lostReason.id }))).status, 200)
  assert.equal((await salesperson(`/api/crm/opportunities/${deal.id}/move`, json("PATCH", { ...loss, stageId: pipeline.stages[1].id }))).status, 409)
  const board = await (await salesperson(`/api/crm/opportunities?pipelineId=${pipeline.id}&stageId=${pipeline.stages[2].id}&kind=LOST&pageSize=1`)).json()
  assert.equal(board.total, 1); assert.equal(board.items[0].probability, 0)
  assert.equal((await salesperson(`/api/crm/opportunities/${deal.id}/activity`, json("POST", { message: "Follow up next quarter." }))).status, 201)
  assert.equal((await (await salesperson(`/api/crm/opportunities/${deal.id}/activity`)).json()).total, 3)
  assert.equal((await session()("/api/crm/work")).status, 401)
  const workInput = { title: "Discuss next quarter", type: "CALL", callDirection: "OUTBOUND", contactId: contact.id, opportunityId: deal.id,
    assignedUserId: salespersonId, dueOn: "2020-01-01", reminderAt: "2020-01-01T08:00:00Z", description: "Review pricing before calling." }
  const workResponse = await admin("/api/crm/work", json("POST", workInput))
  assert.equal(workResponse.status, 201)
  const work = await workResponse.json()
  const overdueBoard = await (await salesperson(`/api/crm/opportunities?pipelineId=${pipeline.id}`)).json()
  assert.equal(overdueBoard.items[0].overdueActivityCount, 1)
  const reminders = await (await salesperson("/api/crm/work?due=reminders")).json()
  assert.ok(reminders.items.some(item => item.id === work.id))
  assert.equal((await admin(`/api/crm/work/${work.id}/reminder`, json("POST", { version: 1, action: "DISMISS" }))).status, 403)
  assert.equal((await salesperson(`/api/crm/work/${work.id}/reminder`, json("POST", { version: 1, action: "SNOOZE", minutes: 15 }))).status, 200)
  assert.equal((await (await salesperson("/api/crm/work?due=reminders")).json()).total, 0)
  assert.equal((await salesperson(`/api/crm/work/${work.id}/history`, json("POST", { message: "Reviewed the pricing." }))).status, 201)
  const completion = { version: 2, summary: "Customer requested a callback next week.", outcome: "CONNECTED", occurredAt: new Date().toISOString(), durationMinutes: 6,
    followUp: { title: "Callback next week", type: "CALL", callDirection: "OUTBOUND", assignedUserId: salespersonId, dueOn: "2030-01-10" } }
  assert.equal((await salesperson(`/api/crm/work/${work.id}/complete`, json("POST", { ...completion, summary: "" }))).status, 400)
  assert.equal((await salesperson(`/api/crm/work/${work.id}/complete`, json("POST", completion))).status, 200)
  assert.equal((await salesperson(`/api/crm/work/${work.id}/complete`, json("POST", completion))).status, 409)
  const interactions = await (await salesperson(`/api/crm/contacts/${contact.id}/interactions`)).json()
  assert.ok(interactions.items.some(item => item.summary === completion.summary))
  assert.ok(interactions.items.every(item => !("description" in item)))
  const calendar = await (await salesperson("/api/crm/work?from=2030-01-01&to=2030-02-01")).json()
  assert.equal(calendar.items.filter(item => item.followUpOfId === work.id).length, 1)
  assert.equal((await (await salesperson(`/api/crm/opportunities?pipelineId=${pipeline.id}`)).json()).items[0].overdueActivityCount, 0)
  assert.ok((await (await salesperson(`/api/crm/work/${work.id}/history`)).json()).total >= 4)
  const overview = await (await salesperson("/api/crm/reports/activities?type=CALL")).json()
  assert.equal(overview.totals.open, 1); assert.equal(overview.totals.completed, 1)
  assert.equal(overview.totals.withoutActivity, 0)
  assert.deepEqual(overview.callOutcomes, [{ outcome: "CONNECTED", count: 1 }])
  assert.equal((await salesperson("/api/crm/reports/activities?scope=team")).status, 403)
  assert.equal((await salesperson("/api/crm/reports/staff?scope=team")).status, 403)
  assert.equal((await salesperson("/api/crm/reports/activities?from=2026-01-01")).status, 400)
  const reportDetail = await (await salesperson(`/api/crm/work?state=completed&type=CALL&completedFrom=${overview.from}&completedThrough=${overview.through}`)).json()
  assert.equal(reportDetail.total, overview.totals.completed)
  assert.equal((await (await admin(`/api/crm/reports/staff?scope=team&assignedUserId=${salespersonId}&type=CALL`)).json()).items[0].completed, 1)
  const planInput = { name: "HTTP follow-up plan", steps: [{ title: "Plan callback", type: "CALL", callDirection: "OUTBOUND", dayOffset: 0, reminderTime: "09:30" }, { title: "Plan email", type: "EMAIL", dayOffset: 2 }] }
  assert.equal((await salesperson("/api/crm/activity-plans", json("POST", planInput))).status, 403)
  const planResponse = await admin("/api/crm/activity-plans", json("POST", planInput))
  assert.equal(planResponse.status, 201)
  const activityPlan = await planResponse.json()
  const application = { version: activityPlan.version, requestKey: require("node:crypto").randomUUID(), contactId: contact.id, enquiryId: source.id, assignedUserId: salespersonId, startOn: "2030-02-01" }
  const preview = await salesperson(`/api/crm/activity-plans/${activityPlan.id}/preview`, json("POST", application))
  assert.equal(preview.status, 200)
  assert.equal((await preview.json()).steps[1].dueOn, "2030-02-03")
  const launchResponse = await salesperson(`/api/crm/activity-plans/${activityPlan.id}/apply`, json("POST", application))
  assert.equal(launchResponse.status, 201)
  const launch = await launchResponse.json()
  assert.equal((await (await salesperson(`/api/crm/activity-plans/${activityPlan.id}/apply`, json("POST", application))).json()).id, launch.id)
  const launchedTasks = await (await salesperson(`/api/crm/work?planLaunchId=${launch.id}`)).json()
  assert.equal(launchedTasks.total, 2)
  assert.equal(launchedTasks.items[0].planLaunch.planName, activityPlan.name)
  assert.equal((await salesperson(`/api/crm/activity-plans/${activityPlan.id}/apply`, json("POST", { ...application, requestKey: require("node:crypto").randomUUID() }))).status, 409)
  assert.equal((await admin(`/api/crm/activity-plans/${activityPlan.id}`, json("PATCH", { ...planInput, version: 1, archived: true }))).status, 200)
  assert.equal((await salesperson(`/api/crm/activity-plans/${activityPlan.id}/preview`, json("POST", { ...application, version: 2 }))).status, 409)
  for (const path of ["/crm/activity-plans", "/crm/activity-plans/new", `/crm/activity-plans/${activityPlan.id}`, `/crm/activity-plans/apply?enquiryId=${source.id}`, `/crm/activities?scope=visible&state=all&planLaunchId=${launch.id}`]) assert.equal((await admin(path)).status, 200, path)
  for (const path of ["/crm/overview", "/crm/activities", `/crm/activities?state=completed&completedFrom=${overview.from}&completedThrough=${overview.through}`, "/crm/activities/new", `/crm/activities/${work.id}`, "/crm/calendar"]) {
    const page = await salesperson(path)
    assert.equal(page.status, 200, `Page failed: ${path}`)
    assert.ok(!(await page.text()).includes("NEXT_HTTP_ERROR_FALLBACK;500"), `Server rendering failed: ${path}`)
  }
  const ruleInput = { name: "HTTP retry rule", sourceType: "CALL", outcome: "NO_ANSWER", maxDepth: 2, nextStep: { title: "Retry unanswered call", type: "CALL", callDirection: "OUTBOUND", dayOffset: 1, reminderTime: "09:30" } }
  assert.equal((await session()("/api/crm/follow-up-rules")).status, 401)
  assert.equal((await salesperson("/api/crm/follow-up-rules", json("POST", ruleInput))).status, 403)
  const ruleResponse = await admin("/api/crm/follow-up-rules", json("POST", ruleInput))
  assert.equal(ruleResponse.status, 201)
  const rule = await ruleResponse.json()
  assert.equal((await (await salesperson(`/api/crm/follow-up-rules/${rule.id}`)).json()).canManage, false)
  const ruleWorkResponse = await admin("/api/crm/work", json("POST", { ...workInput, opportunityId: "", reminderAt: null }))
  assert.equal(ruleWorkResponse.status, 201)
  const ruleWork = await ruleWorkResponse.json()
  const rulePreviewResponse = await salesperson(`/api/crm/work/${ruleWork.id}/follow-up?version=1&outcome=NO_ANSWER`)
  assert.equal(rulePreviewResponse.status, 200)
  const rulePreview = await rulePreviewResponse.json()
  assert.equal(rulePreview.rule.id, rule.id)
  const ruleCompletion = { version: 1, summary: "No answer; retry tomorrow", outcome: "NO_ANSWER", occurredAt: new Date().toISOString() }
  assert.equal((await salesperson(`/api/crm/work/${ruleWork.id}/complete`, json("POST", ruleCompletion))).status, 409)
  const ruleDecision = { id: rule.id, version: rule.version, action: "APPLY", dueOn: rulePreview.schedule.dueOn, reminderAt: rulePreview.schedule.reminderAt }
  assert.equal((await salesperson(`/api/crm/work/${ruleWork.id}/complete`, json("POST", { ...ruleCompletion, ruleDecision }))).status, 200)
  assert.equal((await salesperson(`/api/crm/work/${ruleWork.id}/complete`, json("POST", { ...ruleCompletion, ruleDecision }))).status, 409)
  const generated = (await (await salesperson(`/api/crm/work?contactId=${contact.id}`)).json()).items.filter(item => item.followUpOfId === ruleWork.id)
  assert.equal(generated.length, 1); assert.equal(generated[0].followUpRuleName, rule.name); assert.equal(generated[0].automationDepth, 1)
  for (const path of ["/crm/follow-up-rules", "/crm/follow-up-rules/new", `/crm/follow-up-rules/${rule.id}`, `/crm/activities/${generated[0].id}`]) {
    const page = await admin(path)
    assert.equal(page.status, 200, path)
    assert.ok(!(await page.text()).includes("NEXT_HTTP_ERROR_FALLBACK;500"), path)
  }
  assert.equal((await admin("/api/modules", json("PATCH", { key: "crm", enabled: false }))).status, 200)
  assert.equal((await salesperson("/api/crm/opportunities")).status, 403)
  assert.equal((await salesperson("/api/crm/work")).status, 403)
  assert.equal((await salesperson("/api/crm/reports/activities")).status, 403)
  assert.equal((await salesperson("/api/crm/activity-plans")).status, 403)
  assert.equal((await salesperson("/api/crm/follow-up-rules")).status, 403)
  assert.equal((await admin("/api/modules", json("PATCH", { key: "crm", enabled: true }))).status, 200)
  for (const path of ["/crm/pipelines", "/crm/pipelines/new", `/crm/pipelines/${pipeline.id}`, "/crm/opportunities", "/crm/opportunities/new", `/crm/opportunities/${deal.id}`, `/crm/opportunities/new?enquiryId=${source.id}`, "/crm/accounts", "/crm/accounts/new", `/crm/accounts/${account.id}`, "/crm/contacts", "/crm/contacts/new", `/crm/contacts/${contact.id}`, "/crm/enquiries", "/crm/enquiries/new", `/crm/enquiries/${enquiry.id}`, "/crm/tasks", "/settings/modules", "/appointments"]) {
    const page = await admin(path)
    assert.equal(page.status, 200, `Page failed: ${path}`)
    const html = await page.text()
    assert.ok(!html.includes("NEXT_HTTP_ERROR_FALLBACK;500"), `Server rendering failed: ${path}`)
  }
  assert.equal((await admin(`/api/crm/contacts/${contact.id}/accounts/${account.id}`, { method: "DELETE" })).status, 200)
  assert.equal((await salesperson(`/api/crm/accounts/${account.id}`)).status, 404)
})
