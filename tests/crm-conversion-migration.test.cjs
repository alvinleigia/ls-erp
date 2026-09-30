/* eslint-disable @typescript-eslint/no-require-imports */
const { test } = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const { Client } = require("pg")
const { randomUUID } = require("node:crypto")

test("conversion migration preserves existing stages and enforces one open default per pipeline", async () => {
  const raw = process.env.CRM_TEST_DATABASE_URL
  if (!raw) throw new Error("Set CRM_TEST_DATABASE_URL to the disposable local database.")
  const url = new URL(raw)
  if (!["localhost", "127.0.0.1"].includes(url.hostname) || url.pathname !== "/ls_salon_crm_test") throw new Error("Local test database only.")
  const db = new Client({ connectionString: raw })
  await db.connect()
  try {
    await db.query("BEGIN")
    const schema = `migration_${randomUUID().replaceAll("-", "")}`
    await db.query(`CREATE SCHEMA ${schema}; SET LOCAL search_path TO ${schema}`)
    await db.query(`CREATE TABLE "CrmStage" ("id" text PRIMARY KEY, "tenantId" text, "pipelineId" text, "archived" boolean, "kind" text);
      INSERT INTO "CrmStage" VALUES ('legacy', 'a', 'pipeline', false, 'OPEN')`)
    await db.query(fs.readFileSync("prisma/migrations/20260929210000_crm_conversion_default/migration.sql", "utf8"))
    assert.deepEqual((await db.query('SELECT * FROM "CrmStage"')).rows[0], { id: "legacy", tenantId: "a", pipelineId: "pipeline", archived: false, kind: "OPEN", isConversionDefault: false })
    await db.query(`UPDATE "CrmStage" SET "isConversionDefault" = true WHERE id = 'legacy'`)
    await db.query(`INSERT INTO "CrmStage" VALUES ('other-tenant', 'b', 'pipeline', false, 'OPEN', true), ('other-pipeline', 'a', 'second', false, 'OPEN', true)`)
    for (const [id, archived, kind, code] of [["duplicate", false, "OPEN", "23505"], ["won", false, "WON", "23514"], ["archived", true, "OPEN", "23514"]]) {
      await db.query("SAVEPOINT invalid_default")
      await assert.rejects(db.query('INSERT INTO "CrmStage" VALUES ($1, $2, $3, $4, $5, true)', [id, "a", "pipeline", archived, kind]), error => error.code === code)
      await db.query("ROLLBACK TO SAVEPOINT invalid_default")
    }
  } finally { await db.query("ROLLBACK"); await db.end() }
})
