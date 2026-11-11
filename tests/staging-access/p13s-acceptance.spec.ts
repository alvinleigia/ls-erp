import fs from "node:fs"
import { test } from "@playwright/test"
import { stagingFixture } from "../helpers/p13s-staging"
import { p13sAcceptance } from "../helpers/p13s-acceptance"

test("hosted P13S combined acceptance in a newly provisioned synthetic tenant", async ({ browser }, info) => {
  test.setTimeout(600_000)
  const f = await stagingFixture(browser)
  try {
    const result = await p13sAcceptance({ admin: f.admin, operator: f.operator, reviewer: f.reviewer, info })
    fs.writeFileSync(`tmp/p13s-staging/${f.receipt.slug}-acceptance.json`, JSON.stringify({ ...result, at: new Date().toISOString(), source: f.receipt.source, deployment: f.receipt.deployment, tenantId: f.receipt.tenantId }, null, 2), { mode: 0o600 })
  } finally { await f.close() }
})
