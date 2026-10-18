/* eslint-disable @typescript-eslint/no-require-imports */
// Operational rehearsal only. Never loads .env or accepts a hosted connection.
const { test } = require("node:test")
const assert = require("node:assert/strict")
const { randomBytes } = require("node:crypto")
const { Client } = require("pg")

test("connection freeze and recovery with the production operator privilege shape", async t => {
  assert.equal(process.env.R5_HISTORICAL_CONTAINER, "1")
  const url = new URL(process.env.CRM_TEST_DATABASE_URL)
  assert.equal(url.hostname, "127.0.0.1")
  assert.equal(url.pathname, "/ls_salon_crm_test")
  const suffix = randomBytes(6).toString("hex")
  const runtime = `freeze_runtime_${suffix}`, operator = `freeze_operator_${suffix}`, table = `freeze_data_${suffix}`
  const root = new Client({ connectionString: url.toString() })
  const clients = []
  const connect = async user => {
    const address = new URL(url); address.username = user; address.password = ""
    const client = new Client({ connectionString: address.toString(), connectionTimeoutMillis: 3000 })
    // Expected during pg_terminate_backend; rejected queries are checked below.
    client.on("error", () => {})
    clients.push(client); await client.connect(); return client
  }
  await root.connect()
  let original, control, writer, pid, beforeAcl
  const thaw = () => control.query(`ALTER ROLE ${runtime} LOGIN CONNECTION LIMIT ${original.rolconnlimit}`)
  try {
    await root.query(`CREATE ROLE ${runtime} LOGIN NOSUPERUSER NOBYPASSRLS CONNECTION LIMIT 3;
      CREATE ROLE ${operator} LOGIN NOSUPERUSER NOBYPASSRLS CREATEROLE;
      GRANT pg_signal_backend TO ${operator};
      GRANT ${runtime} TO ${operator} WITH ADMIN TRUE, INHERIT FALSE, SET FALSE;
      CREATE TABLE ${table} (id integer PRIMARY KEY, value text NOT NULL);
      INSERT INTO ${table} VALUES (1,'preserve');
      GRANT SELECT,INSERT,UPDATE,DELETE ON ${table} TO ${runtime}`)
    control = await connect(operator)
    original = (await root.query("SELECT rolcanlogin,rolconnlimit FROM pg_roles WHERE rolname=$1", [runtime])).rows[0]
    beforeAcl = (await root.query("SELECT relacl::text FROM pg_class WHERE relname=$1", [table])).rows[0]

    await t.test("operator is non-superuser with ADMIN but no SET ROLE permission", async () => {
      const result = (await control.query("SELECT rolsuper,rolbypassrls,pg_has_role(current_user,$1,'SET') AS can_set FROM pg_roles WHERE rolname=current_user", [runtime])).rows[0]
      assert.deepEqual(result, { rolsuper: false, rolbypassrls: false, can_set: false })
      writer = await connect(runtime)
      pid = (await writer.query("SELECT pg_backend_pid() AS pid")).rows[0].pid
      await writer.query(`BEGIN; INSERT INTO ${table} VALUES (2,'uncommitted')`)
    })
    await t.test("freeze denies new connections; existing sessions still need draining", async () => {
      await control.query(`ALTER ROLE ${runtime} NOLOGIN CONNECTION LIMIT 0`)
      await assert.rejects(connect(runtime), error => error.code === "28000")
      assert.equal((await writer.query(`SELECT count(*)::int AS n FROM ${table}`)).rows[0].n, 2)
    })
    await t.test("drain terminates the existing writer and rolls back its pending save", async () => {
      assert.equal((await control.query("SELECT pg_terminate_backend($1,5000) AS stopped", [pid])).rows[0].stopped, true)
      await assert.rejects(writer.query("COMMIT"))
      assert.equal((await root.query("SELECT count(*)::int AS n FROM pg_stat_activity WHERE usename=$1", [runtime])).rows[0].n, 0)
      assert.deepEqual((await root.query(`SELECT * FROM ${table} ORDER BY id`)).rows, [{ id: 1, value: "preserve" }])
      await assert.rejects(connect(runtime), error => error.code === "28000")
    })
    await t.test("operator migration and read-only reconciliation work while runtime is blocked", async () => {
      await root.query(`ALTER TABLE ${table} ADD COLUMN version integer NOT NULL DEFAULT 1`)
      await root.query("BEGIN READ ONLY")
      try { assert.deepEqual((await root.query(`SELECT * FROM ${table}`)).rows, [{ id: 1, value: "preserve", version: 1 }]) }
      finally { await root.query("ROLLBACK") }
      await assert.rejects(connect(runtime), error => error.code === "28000")
    })
    await t.test("reopening restores prior connection limit and unchanged grants", async () => {
      await thaw()
      assert.deepEqual((await root.query("SELECT rolcanlogin,rolconnlimit FROM pg_roles WHERE rolname=$1", [runtime])).rows[0], original)
      assert.deepEqual((await root.query("SELECT relacl::text FROM pg_class WHERE relname=$1", [table])).rows[0], beforeAcl)
      const fresh = await connect(runtime)
      await fresh.query(`INSERT INTO ${table} (id,value) VALUES (3,'after reopen')`)
      assert.equal((await fresh.query(`SELECT count(*)::int AS n FROM ${table}`)).rows[0].n, 2)
      await fresh.end()
    })
    await t.test("aborting before migration restores access without changing saved records", async () => {
      await control.query(`ALTER ROLE ${runtime} NOLOGIN CONNECTION LIMIT 0`)
      try { await assert.rejects(connect(runtime), error => error.code === "28000") }
      finally { await thaw() }
      const fresh = await connect(runtime)
      assert.deepEqual((await fresh.query(`SELECT id,value FROM ${table} ORDER BY id`)).rows, [{ id: 1, value: "preserve" }, { id: 3, value: "after reopen" }])
    })
  } finally {
    // Only synthetic objects in this disposable database are eligible for cleanup.
    await Promise.allSettled(clients.map(client => client.end()))
    await root.query(`DROP TABLE IF EXISTS ${table}; DROP ROLE IF EXISTS ${operator}; DROP ROLE IF EXISTS ${runtime}`)
    await root.end()
  }
})
