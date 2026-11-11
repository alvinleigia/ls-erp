/* eslint-disable @typescript-eslint/no-explicit-any -- Provisioning responses are validated by their public APIs. */
import fs from "node:fs"
import { randomUUID } from "node:crypto"
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { parse } from "dotenv"
import { expect, request, type Browser } from "@playwright/test"
const run = promisify(execFile), team = "team_Me0kX6NgE1RN4MNKRXXCfrsZ", project = "prj_zZjjsQX2pp1qVz7vE2FrmZWU8rM0", root = "https://ls-erp-staging.vercel.app", dir = "tmp/p13s-staging"
const cli = "C:/Users/Alvin/AppData/Local/npm-cache/_npx/69f9afb961c37556/node_modules/vercel/dist/vc.js"
async function vercel(path: string, method = "GET", body?: unknown) {
  const args = [cli, "api", path + (path.includes("?") ? "&" : "?") + "teamId=" + team, "--scope", "leiwissen", "--method", method, "--raw"]
  // Only domain/alias metadata is sent on stdin; never credentials or sessions.
  if (body !== undefined) args.push("--input", "-")
  if (body === undefined) return JSON.parse((await run(process.execPath, args, { windowsHide: true, maxBuffer: 2e6, timeout: 45000 })).stdout)
  const { spawn } = await import("node:child_process")
  return new Promise<any>((resolve, reject) => {
    const child = spawn(process.execPath, args, { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] }); let out = ""
    child.stdout.on("data", x => { out += x }); child.stderr.resume(); child.stdin.end(JSON.stringify(body))
    const timeout = setTimeout(() => { child.kill(); reject(Error("Staging alias operation timed out")) }, 45000)
    child.on("error", () => { clearTimeout(timeout); reject(Error("Staging alias operation unavailable")) })
    child.on("close", code => { clearTimeout(timeout); if (code) reject(Error("Staging alias operation failed")); else { try { resolve(JSON.parse(out)) } catch { reject(Error("Invalid staging alias receipt")) } } })
  })
}
export async function stagingFixture(browser: Browser) {
  expect(process.env.RUN_P13S_STAGING_WRITES).toBe("1")
  const env = parse(fs.readFileSync(".env.new-vercel-staging")), release = JSON.parse(fs.readFileSync(`${dir}/deployment.json`, "utf8")), baseline = JSON.parse(fs.readFileSync(`${dir}/vercel-baseline.json`, "utf8"))
  expect(new URL(env.NEXTAUTH_URL).origin).toBe(root); expect(new URL(env.SUPABASE_URL).hostname).toBe("oyhsrcmjhwxhvepdbcdc.supabase.co")
  expect(release.project).toBe(project); expect(release.ready).toBe(true)
  const d = await vercel(`/v13/deployments/${release.id}`), alias = await vercel("/v4/aliases/ls-erp-staging.vercel.app"), prod = await vercel("/v4/aliases/erp.ewissen.in")
  expect(d.projectId).toBe(project); expect(d.readyState).toBe("READY"); expect(d.meta?.githubCommitSha || d.meta?.gitCommitSha).toBe(release.source)
  expect(alias.projectId).toBe(project); expect(alias.deploymentId || alias.deployment?.id).toBe(release.id)
  expect(prod.deploymentId || prod.deployment?.id).toBe(baseline.productionDeployment)
  const secret = randomUUID() + "Qa!9", slug = "qa-p13s-" + randomUUID().slice(0, 8), host = "ls-erp-staging-" + slug + ".vercel.app", origin = "https://" + host
  const platform = await request.newContext({ baseURL: root }), sessions: Awaited<ReturnType<Browser["newContext"]>>[] = []
  const json = async (c: any, path: string, method = "GET", data?: unknown, status = 200) => { const r = await c.fetch(path, { method, ...(data === undefined ? {} : { data }) }); expect(r.status(), `${method} ${path}`).toBe(status); return r.json() }
  const auth = async (c: any, base: string, email: string, password: string) => { const csrf = await json(c, "/api/auth/csrf"); await c.post("/api/auth/callback/credentials", { form: { csrfToken: csrf.csrfToken, email, password, callbackUrl: base + "/dashboard" } }); const session = await json(c, "/api/auth/session"); expect(session.user?.email).toBe(email); return session }
  try {
    await auth(platform, root, env.PLATFORM_ADMIN_EMAIL, env.PLATFORM_ADMIN_PASSWORD)
    const tenant = await json(platform, "/api/tenants", "POST", { name: "P13S Synthetic Acceptance " + slug, slug, customDomain: host, adminName: "P13S QA Administrator", adminEmail: slug + "@example.test", adminPassword: secret, modules: ["crm", "salesDocuments", "paymentPlans", "salesOrders", "catalog", "receivables", "customerVerification"] }, 201)
    const receipt = { at: new Date().toISOString(), project, deployment: release.id, source: release.source, origin, slug, tenantId: tenant.tenant.id, admin: tenant.admin, password: secret }
    fs.writeFileSync(`${dir}/${slug}.json`, JSON.stringify(receipt, null, 2), { mode: 0o600 })
    await vercel(`/v10/projects/${project}/domains`, "POST", { name: host }); await vercel(`/v2/deployments/${release.id}/aliases`, "POST", { alias: host })
    expect((await vercel(`/v4/aliases/${host}`)).projectId).toBe(project)
    const session = await browser.newContext({ baseURL: origin }); sessions.push(session); await auth(session.request, origin, tenant.admin.email, secret)
    const users = [tenant.admin]
    for (const [key, role] of [["collections", "MANAGER"], ["reviewer", "STAFF"]]) {
      const result = await json(session.request, "/api/users", "POST", { name: "P13S QA " + key, email: slug + "-" + key + "@example.test", role, password: secret, accessRoleIds: [] })
      users.push(result.user)
    }
    const actors = []
    for (const [i, user] of users.entries()) {
      const context = i === 0 ? session : await browser.newContext({ baseURL: origin }); if (i !== 0) { sessions.push(context); const signed = await auth(context.request, origin, user.email, secret); expect(signed.user.tenantId).toBe(tenant.tenant.id) }
      actors.push({ context, page: await context.newPage(), id: user.id })
    }
    return { admin: actors[0], operator: actors[1], reviewer: actors[2], receipt, async close() { for (const c of sessions) await c.close() } }
  } catch (e) { for (const c of sessions) await c.close(); throw e } finally { await platform.dispose() }
}
