import { test } from "@playwright/test"
import { seed, login } from "./fixtures"
import { p13sAcceptance } from "../helpers/p13s-acceptance"

test("combined CP, multi-applicant KYC, generic booking, private documents and payment acceptance", async ({ browser }, info) => {
  test.setTimeout(240_000)
  const f = await seed(), sessions = []
  try {
    for (const key of ["customerVerification", "salesOrders", "catalog", "receivables"]) await f.db.query('INSERT INTO "TenantModule"("tenantId",key,allowed,enabled,"updatedAt") VALUES($1,$2,true,true,now()) ON CONFLICT("tenantId",key) DO UPDATE SET allowed=true,enabled=true', [f.slug, key])
    await f.db.query('UPDATE "TenantModule" SET enabled=false WHERE "tenantId"=$1 AND key=\'realEstate\'', [f.slug])
    for (const u of [f.users.admin, f.users.manager, f.users.staff]) {
      const session = await login(browser, f.origin, u.email); sessions.push({ ...session, id: u.id })
      await session.context.route("https://verificationtest.supabase.co/**", async route => { const u = new URL(route.request().url()), response = await route.fetch({ url: "http://127.0.0.1:3319" + u.pathname + u.search }); await route.fulfill({ response }) })
      // APIRequestContext does not use browser routes. The guard below is local-only.
      const put = session.context.request.put.bind(session.context.request), get = session.context.request.get.bind(session.context.request)
      const local = (url: string) => url.startsWith("https://verificationtest.supabase.co/") ? url.replace("https://verificationtest.supabase.co", "http://127.0.0.1:3319") : url
      session.context.request.put = (url, options) => put(local(url), options)
      session.context.request.get = (url, options) => get(local(url), options)
    }
    await p13sAcceptance({ admin: sessions[0], operator: sessions[1], reviewer: sessions[2], info })
  } finally { for (const s of sessions) await s.context.close(); await f.db.end() }
})
