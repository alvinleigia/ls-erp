/* eslint-disable @typescript-eslint/no-require-imports */
// Synthetic accounts only, for the isolated HTTP smoke test. Never loads .env.
const { PrismaClient } = require("@prisma/client")
const { PrismaPg } = require("@prisma/adapter-pg")
const { Pool } = require("pg")
const bcrypt = require("bcryptjs")

async function main() {
  const connectionString = process.env.CRM_TEST_DATABASE_URL
  if (!connectionString) throw new Error("CRM_TEST_DATABASE_URL is required.")
  const url = new URL(connectionString)
  if (!["localhost", "127.0.0.1"].includes(url.hostname) || url.pathname !== "/ls_salon_crm_test") throw new Error("Only the local CRM test database is permitted.")
  const db = new PrismaClient({ adapter: new PrismaPg(new Pool({ connectionString }), { disposeExternalPool: true }) })
  try {
    const passwordHash = await bcrypt.hash("LocalCrmTest!2026", 10)
    await db.$transaction(async tx => {
      await tx.tenant.create({ data: { id: "crm_demo", slug: "crm-demo", name: "CRM Demo" } })
      await tx.user.createMany({ data: [
        { tenantId: "crm_demo", name: "Demo Administrator", email: "admin@crm-demo.test", role: "ADMIN", passwordHash },
        { tenantId: "crm_demo", name: "Demo Salesperson", email: "sales@crm-demo.test", role: "STAFF", passwordHash },
      ] })
      await tx.appSetting.create({ data: { tenantId: "crm_demo", timeZone: "Asia/Kolkata", locale: "en-IN", currency: "INR", dateFormat: "dd/MM/yyyy" } })
    })
    console.log("Created synthetic CRM demo accounts in the isolated test database.")
  } finally { await db.$disconnect() }
}
main().catch(error => { console.error(error.message); process.exitCode = 1 })
