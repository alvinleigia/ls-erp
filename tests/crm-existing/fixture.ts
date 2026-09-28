import { expect, type APIRequestContext } from "@playwright/test"

// Existing synthetic records created during the user's CRM testing. No seed,
// credentials, reset, or business-data writes belong in this suite.
export const records = {
  tenant: "cmujf0fam000004kxega1gqj4",
  contact: "cmujgbmp8000004lb6z5sbr5z",
  privateContact: "cmuk0bs1l000304jswhmrzrbg",
  enquiry: "cmujq6m2t000004lbvgbhcelf",
  converted: "cmujrm6xk000004jq91z4aoq9",
  openDeal: "cmuk0q03h000404kxa6qwlnzs",
  lostDeal: "cmujrx217000004jqogttondt",
  privateWork: "cmuk05v8p000004jste9kq3k0",
  staffWork: "cmujzer80000004jkua615exh",
}
export const period = "from=2026-09-01&through=2026-09-28"

export async function get(request: APIRequestContext, path: string) {
  const response = await request.get(path)
  expect(response.status(), `GET ${path}`).toBe(200)
  expect(response.headers()["content-type"]).toContain("application/json")
  return response.json()
}

export async function verifyLogin(request: APIRequestContext, role: string) {
  const { user } = await get(request, "/api/auth/session")
  expect(user?.tenantId, "Save a current login for the CRM Test business.").toBe(records.tenant)
  expect(user?.role, "Use the matching admin/staff saved login.").toBe(role)
  return user
}

export async function listAll(request: APIRequestContext, path: string) {
  const separator = path.includes("?") ? "&" : "?"
  const first = await get(request, `${path}${separator}page=1&pageSize=100`)
  expect(first.totalPages, "This suite is for the small existing synthetic dataset.").toBeLessThanOrEqual(10)
  const items = [...first.items]
  for (let page = 2; page <= first.totalPages; page++) items.push(...(await get(request, `${path}${separator}page=${page}&pageSize=100`)).items)
  expect(items).toHaveLength(first.total)
  expect(new Set(items.map(row => row.id)).size).toBe(first.total)
  return items
}
