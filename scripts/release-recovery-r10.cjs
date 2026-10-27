/* eslint-disable @typescript-eslint/no-require-imports */
// Disposable synthetic Docker recovery test, never a hosted/pilot backup utility.
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const { spawnSync } = require('node:child_process')
const { Client } = require('pg')
const { capture, localUrl, sha } = require('./industry-release.cjs')
const { verifySource, historyProblems } = require('./release-readiness-r10.cjs')
const { protect, seal, open, privateDirectory } = require('./storage-recovery.cjs')
const root = path.resolve(__dirname, '..')
let evidenceDirectory

function command(file, args, options = {}) {
  const result = spawnSync(file, args, { cwd: root, windowsHide: true, maxBuffer: 64 * 1024 * 1024, ...options })
  if (result.status !== 0 && evidenceDirectory) fs.writeFileSync(path.join(evidenceDirectory, 'failed-command.log'), Buffer.concat([result.stdout || Buffer.alloc(0), result.stderr || Buffer.alloc(0)]), { mode: 0o600 })
  assert.equal(result.status, 0, 'Local recovery command failed; command output withheld')
  return result.stdout
}
const docker = args => command('docker', args).toString().trim()
const qi = value => '"' + value.replaceAll('"', '""') + '"'
const recoverySnapshot = url => capture(url, { canonicalConstraints: true })
// Preserve every direct grant, grantor and grant option, independent of array order
// or PostgreSQL's NULL shorthand for the built-in default function ACL.
const functionAclSql = `(SELECT jsonb_agg(jsonb_build_array(pg_get_userbyid(a.grantor),CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END,a.privilege_type,a.is_grantable)
  ORDER BY pg_get_userbyid(a.grantor),CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END,a.privilege_type,a.is_grantable)
  FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a)`

async function securitySnapshot(url) {
  const db = new Client({ connectionString: localUrl(url) })
  await db.connect()
  try {
    await db.query("SET TIME ZONE 'UTC'")
    const queries = {
      roles: `SELECT rolname,rolsuper,rolinherit,rolcreaterole,rolcreatedb,rolcanlogin,rolreplication,rolconnlimit,rolvaliduntil::text,rolbypassrls,md5(coalesce(rolpassword,'')) AS password_hash FROM pg_authid ORDER BY rolname`,
      roleSettings: `SELECT r.rolname,d.datname,s.setconfig FROM pg_db_role_setting s LEFT JOIN pg_roles r ON r.oid=s.setrole LEFT JOIN pg_database d ON d.oid=s.setdatabase ORDER BY r.rolname,d.datname`,
      membership: `SELECT r.rolname role,m.rolname member,g.rolname grantor,a.admin_option,a.inherit_option,a.set_option FROM pg_auth_members a JOIN pg_roles r ON r.oid=a.roleid JOIN pg_roles m ON m.oid=a.member JOIN pg_roles g ON g.oid=a.grantor ORDER BY role,member,grantor`,
      schemas: `SELECT nspname,pg_get_userbyid(nspowner) owner,nspacl FROM pg_namespace WHERE nspname IN ('public','app') ORDER BY nspname`,
      relations: `SELECT n.nspname,c.relname,c.relkind,pg_get_userbyid(c.relowner) owner,c.relacl FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','app') ORDER BY n.nspname,c.relname`,
      functions: `SELECT n.nspname,p.proname,pg_get_function_identity_arguments(p.oid) args,pg_get_userbyid(p.proowner) owner,${functionAclSql} acl,
        p.prosecdef,p.proconfig,p.provolatile,p.proleakproof FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('public','app') ORDER BY n.nspname,p.proname,args`,
      defaults: `SELECT pg_get_userbyid(a.defaclrole) owner,n.nspname,a.defaclobjtype,a.defaclacl FROM pg_default_acl a LEFT JOIN pg_namespace n ON n.oid=a.defaclnamespace ORDER BY owner,n.nspname,a.defaclobjtype`,
      triggers: `SELECT n.nspname,c.relname,t.tgname,t.tgenabled,pg_get_triggerdef(t.oid) definition FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','app') AND NOT t.tgisinternal ORDER BY n.nspname,c.relname,t.tgname`,
      migrationRows: `SELECT to_jsonb(m) AS row FROM public._prisma_migrations m ORDER BY migration_name,id`,
    }
    const snapshot = {}
    for (const [name, sql] of Object.entries(queries)) snapshot[name] = sha(JSON.stringify((await db.query(sql)).rows))
    const sequences = (await db.query("SELECT schemaname,sequencename FROM pg_sequences WHERE schemaname IN ('public','app') ORDER BY schemaname,sequencename")).rows
    snapshot.sequences = []
    for (const s of sequences) snapshot.sequences.push({ ...s, ...(await db.query(`SELECT last_value::text,is_called FROM ${qi(s.schemaname)}.${qi(s.sequencename)}`)).rows[0] })
    return snapshot
  } finally { await db.end() }
}

async function main() {
  verifySource()
  assert.equal(process.env.R10_SYNTHETIC_RECOVERY, '1', 'Use the isolated release recovery runner')
  const source = process.env.R10_RECOVERY_CONTAINER
  assert.match(source || '', /^ls-erp-sales-orders-[a-f0-9]{12}$/)
  const sourceUrl = new URL(localUrl(process.env.RECONCILE_DATABASE_URL))
  assert.equal(sourceUrl.pathname, '/ls_salon_crm_test')
  assert.equal(sourceUrl.hostname, '127.0.0.1')
  const info = JSON.parse(docker(['inspect', source]))[0]
  assert.equal(info.Name, '/' + source)
  assert.equal(info.HostConfig.PortBindings['5432/tcp'][0].HostIp, '127.0.0.1')
  assert.equal(info.NetworkSettings.Ports['5432/tcp'][0].HostPort, sourceUrl.port)
  assert.ok(info.Config.Env.includes('POSTGRES_HOST_AUTH_METHOD=trust'))
  const id = crypto.randomBytes(6).toString('hex'), target = 'ls-erp-r10-recovery-' + id
  const evidence = path.join(root, 'tmp/industry-release', target)
  privateDirectory(evidence)
  evidenceDirectory = evidence
  const write = (name, bytes) => fs.writeFileSync(path.join(evidence, name), bytes, { flag: 'wx', mode: 0o600 })
  let started = false
  try {
    console.log('R10 recovery: capturing synthetic rows, schema, role grants and ownership.')
    const before = await recoverySnapshot(sourceUrl.toString()), security = await securitySnapshot(sourceUrl.toString())
    assert.deepEqual(historyProblems(before.migrations), [])
    assert.deepEqual(before.foreignKeyViolations, [])
    const archive = command('docker', ['exec', source, 'pg_dump', '-U', 'postgres', '-d', 'ls_salon_crm_test', '--format=custom'])
    const globals = command('docker', ['exec', source, 'pg_dumpall', '-U', 'postgres', '--roles-only'])
    const key = crypto.randomBytes(32)
    try {
      write('key.dpapi', protect(key))
      write('database.enc', seal(archive, key, 'R10 synthetic database'))
      write('roles.enc', seal(globals, key, 'R10 synthetic roles'))
    } finally { key.fill(0) }
    const databaseHash = sha(archive), rolesHash = sha(globals)
    archive.fill(0); globals.fill(0)
    // Restore from the persisted encrypted files, not the original in-memory dump.
    const restoredKey = protect(fs.readFileSync(path.join(evidence, 'key.dpapi')), true)
    let recovered, roles
    try {
      const encrypted = fs.readFileSync(path.join(evidence, 'database.enc'))
      const tampered = Buffer.from(encrypted); tampered[tampered.length - 1] ^= 1
      assert.throws(() => open(tampered, restoredKey, 'R10 synthetic database'))
      assert.throws(() => open(encrypted, restoredKey, 'wrong archive'))
      recovered = open(encrypted, restoredKey, 'R10 synthetic database')
      roles = open(fs.readFileSync(path.join(evidence, 'roles.enc')), restoredKey, 'R10 synthetic roles')
      assert.equal(sha(recovered), databaseHash); assert.equal(sha(roles), rolesHash)
    } finally { restoredKey.fill(0) }
    try {
      docker(['run', '--detach', '--name', target, '--label', 'ls-erp.r10-recovery=' + id, '--publish', '127.0.0.1::5432', '--tmpfs', '/var/lib/postgresql/data:rw,noexec,nosuid,size=512m', '--env', 'POSTGRES_HOST_AUTH_METHOD=trust', '--env', 'POSTGRES_DB=ls_erp_rehearsal', info.Image])
      started = true
      for (let i = 0;; i++) {
        const ready = spawnSync('docker', ['exec', target, 'pg_isready', '-U', 'postgres', '-d', 'ls_erp_rehearsal'], { windowsHide: true })
        if (ready.status === 0) break
        assert.ok(i < 29, 'Restore container did not become ready')
        await new Promise(resolve => setTimeout(resolve, 500))
      }
      const port = docker(['port', target, '5432/tcp']).split(':').pop()
      const deployUrl = `postgresql://postgres@127.0.0.1:${port}/ls_erp_rehearsal`
      console.log('R10 recovery: checking actual Prisma deploy order on an empty local database.')
      const deploy = command(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], { env: { ...process.env, DATABASE_URL: deployUrl, DIRECT_URL: deployUrl }, timeout: 180000 })
      write('prisma-deploy.log', deploy)
      const deployed = await recoverySnapshot(deployUrl)
      assert.deepEqual(historyProblems(deployed.migrations), [])
      assert.deepEqual(deployed.schemaObjects, before.schemaObjects, 'Prisma deployment order changed enum/function definitions')
      assert.deepEqual(Object.keys(deployed.tables), Object.keys(before.tables))
      for (const [name, table] of Object.entries(before.tables)) {
        const sourceSchema = { ...table }, deployedSchema = { ...deployed.tables[name] }
        delete sourceSchema.partitions; delete deployedSchema.partitions
        assert.deepEqual(deployedSchema, sourceSchema, `Prisma deployment order changed schema/RLS: ${name}`)
      }
      // Only the known Docker bootstrap role already exists in the fresh cluster.
      // Keep its ALTER ROLE and every other role/grant, with pg_restore ACLs intact.
      const rolesSql = roles.toString()
      assert.equal((rolesSql.match(/^CREATE ROLE postgres;$/gm) || []).length, 1)
      command('docker', ['exec', '-i', target, 'psql', '-X', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', 'postgres'], { input: rolesSql.replace(/^CREATE ROLE postgres;\r?\n/m, '') })
      docker(['exec', target, 'createdb', '-U', 'postgres', 'ls_salon_crm_test'])
      command('docker', ['exec', '-i', target, 'pg_restore', '-U', 'postgres', '-d', 'ls_salon_crm_test', '--exit-on-error', '--single-transaction'], { input: recovered })
      const restoreUrl = `postgresql://postgres@127.0.0.1:${port}/ls_salon_crm_test`
      assert.deepEqual(await recoverySnapshot(restoreUrl), before, 'Restored data/schema/RLS/history fingerprints differ')
      assert.deepEqual(await securitySnapshot(restoreUrl), security, 'Restored security catalog differs')
      console.log('R10 recovery: exact restore passed; running native office, external-login and stock access tests on the restored database.')
      const checks = command(process.execPath, ['--require', './tests/register.cjs', '--test', '--test-reporter=tap', '--test-concurrency=1', '--test-force-exit', '--test-timeout=60000', 'tests/release-recovery-r10.integration.test.cjs', 'tests/office-records.integration.test.cjs', 'tests/external-logins.integration.test.cjs', 'tests/inventory-office.integration.test.cjs'], { env: { ...process.env, CRM_TEST_DATABASE_URL: restoreUrl, DATABASE_URL: restoreUrl, DIRECT_URL: restoreUrl, NODE_ENV: 'test', SUPABASE_URL: '', SUPABASE_SECRET_KEY: '', SUPABASE_SERVICE_ROLE_KEY: '', SMTP_HOST: '', MAIL_FROM: '' }, timeout: 180000 })
      write('restored-access.log', checks)
      const summary = checks.toString().split('\n').filter(line => /^# (tests|pass|fail|skipped)/.test(line))
      assert.ok(summary.some(line => /^# tests [1-9][0-9]*$/.test(line)))
      assert.ok(summary.includes('# fail 0') && summary.includes('# skipped 0'))
      console.log(summary.join('\n'))
      write('receipt.json', JSON.stringify({ format: 1, syntheticOnly: true, createdAt: new Date().toISOString(), sourceManifestSha256: sha(fs.readFileSync(path.join(root, 'docs/release-source-r10.json'))), postgresImage: info.Image, migrations: before.migrations.length, tables: Object.keys(before.tables).length, encryptedArchiveSha256: sha(fs.readFileSync(path.join(evidence, 'database.enc'))), restoreDataAndSecurityExact: true, restoredAccessTests: summary, hostedHistoryVerified: false, pilotRecoveryVerified: false, releaseApproved: false }, null, 2) + '\n')
      console.log('R10 synthetic recovery passed. Evidence: ' + path.relative(root, evidence))
    } finally { recovered?.fill(0); roles?.fill(0) }
  } finally {
    if (started) {
      const owned = JSON.parse(docker(['inspect', target]))[0]
      assert.equal(owned.Name, '/' + target)
      assert.equal(owned.Config.Labels['ls-erp.r10-recovery'], id)
      docker(['rm', '--force', target])
    }
  }
}
if (require.main === module) main().catch(error => {
  if (evidenceDirectory) fs.writeFileSync(path.join(evidenceDirectory, 'failure.log'), error.stack || error.message, { mode: 0o600 })
  console.error('R10 synthetic recovery failed. No hosted changes were made; incomplete evidence is not a release gate.')
  process.exitCode = 1
})
module.exports = { securitySnapshot, functionAclSql }
