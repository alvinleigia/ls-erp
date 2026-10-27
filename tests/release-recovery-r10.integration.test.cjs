/* eslint-disable @typescript-eslint/no-require-imports */
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { Client } = require('pg')
const { capture, localUrl } = require('../scripts/industry-release.cjs')
const { functionAclSql } = require('../scripts/release-recovery-r10.cjs')
const url = localUrl(process.env.CRM_TEST_DATABASE_URL)

test('canonical PostgreSQL constraints ignore redundant AND grouping but preserve AND/OR precedence', async () => {
  const db = new Client({ connectionString: url })
  await db.connect()
  try {
    await db.query(`CREATE TEMP TABLE r10_constraint_probe(a int,b int,c int,
      CONSTRAINT a_nested CHECK(((a>0 AND b>0) AND c>0)),
      CONSTRAINT b_flat CHECK(a>0 AND b>0 AND c>0),
      CONSTRAINT c_group CHECK((a>0 OR b>0) AND c>0),
      CONSTRAINT d_group CHECK(a>0 OR (b>0 AND c>0)))`)
    const rows = (await db.query("SELECT conname,pg_get_constraintdef(oid,true) definition FROM pg_constraint WHERE conrelid='r10_constraint_probe'::regclass ORDER BY conname")).rows
    assert.equal(rows.length, 4)
    assert.equal(rows[0].definition, rows[1].definition)
    assert.notEqual(rows[2].definition, rows[3].definition)
  } finally { await db.end() }
})

test('recovery format 3 changes only canonical constraint text; historical format 2 remains available', async () => {
  const historical = await capture(url), recovery = await capture(url, { canonicalConstraints: true })
  assert.equal(historical.format, 2); assert.equal(recovery.format, 3)
  assert.equal(historical.serverMajor, '17')
  const normalized = structuredClone(historical)
  normalized.format = 3
  for (const [name, table] of Object.entries(normalized.tables)) {
    assert.equal(table.constraints.length, recovery.tables[name].constraints.length)
    table.constraints = table.constraints.map((c, i) => {
      const canonical = recovery.tables[name].constraints[i]
      assert.deepEqual({ ...c, definition: canonical.definition }, canonical)
      return canonical
    })
  }
  assert.deepEqual(normalized, recovery)
})

test('function ACL comparison preserves revocation, direct grants and grant options', async () => {
  const db = new Client({ connectionString: url })
  await db.connect()
  try {
    await db.query("CREATE TEMP TABLE r10_acl_session(id int); CREATE FUNCTION pg_temp.r10_acl_probe() RETURNS int LANGUAGE sql AS 'SELECT 1'")
    const acl = async () => (await db.query(`SELECT ${functionAclSql} acl FROM pg_proc p WHERE p.oid='pg_temp.r10_acl_probe()'::regprocedure`)).rows[0].acl
    const original = await acl()
    await db.query('REVOKE EXECUTE ON FUNCTION pg_temp.r10_acl_probe() FROM PUBLIC')
    assert.notDeepEqual(await acl(), original)
    await db.query('GRANT EXECUTE ON FUNCTION pg_temp.r10_acl_probe() TO PUBLIC')
    assert.deepEqual(await acl(), original)
    await db.query('GRANT EXECUTE ON FUNCTION pg_temp.r10_acl_probe() TO crm_test_runtime')
    const direct = await acl(); assert.notDeepEqual(direct, original)
    await db.query('GRANT EXECUTE ON FUNCTION pg_temp.r10_acl_probe() TO crm_test_runtime WITH GRANT OPTION')
    assert.notDeepEqual(await acl(), direct)
    await db.query('REVOKE ALL ON FUNCTION pg_temp.r10_acl_probe() FROM crm_test_runtime')
    assert.deepEqual(await acl(), original)
  } finally { await db.end() }
})
