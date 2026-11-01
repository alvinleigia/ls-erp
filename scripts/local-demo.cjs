/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('node:fs')
const path = require('node:path')
const { spawn, spawnSync } = require('node:child_process')
const { randomBytes } = require('node:crypto')
const dotenv = require('dotenv')
const { Client } = require('pg')
const bcrypt = require('bcryptjs')
const net = require('node:net')
const { root, localUrl, migrate, run } = require('./database-workflow.cjs')
const file = path.join(root, '.env.local-demo'), directory = path.join(root, 'tmp/local-demo')
const compose = ['compose', '--env-file', file, '-f', path.join(root, 'compose.local-demo.yml')]
const token = () => randomBytes(24).toString('base64url')
function cleanEnv(values) {
  const env = { ...process.env }
  for (const name of ['.env', '.env.local', '.env.development', '.env.development.local', '.env.production', '.env.production.local']) {
    if (fs.existsSync(path.join(root, name))) for (const key of Object.keys(dotenv.parse(fs.readFileSync(path.join(root, name))))) env[key] = ''
  }
  for (const key of Object.keys(env)) if (/^(?:SUPABASE|NEXT_PUBLIC_SUPABASE|SMTP_|MAIL_|PLATFORM_ADMIN_|AUTH_|NEXTAUTH_|VERCEL|DATABASE_URL|DIRECT_URL|MIGRATION_DATABASE_URL)/.test(key)) env[key] = ''
  return { ...env, ...values, ERP_LOCAL_DEMO: '1', NODE_ENV: 'development', AUTH_TRUST_HOST: 'true', AUTH_URL: 'http://localhost:3109', NEXTAUTH_URL: 'http://localhost:3109', APP_ROOT_DOMAIN: 'localhost', PLATFORM_ADMIN_TENANT_SLUG: 'platform', RLS_POOL_MAX: '4' }
}
function configuration() {
  if (!fs.existsSync(file)) {
    const old = spawnSync('docker', ['volume', 'inspect', 'ls-erp-local-demo_demo-data'], { windowsHide: true, stdio: 'ignore' })
    if (old.status === 0) throw Error('Local demo data exists but .env.local-demo is missing. Recover that file before starting; existing data was preserved.')
    const password = token(), runtime = token()
    const values = { LOCAL_DB_PASSWORD: password, DATABASE_URL: `postgresql://crm_test_runtime:${runtime}@127.0.0.1:55445/ls_salon_crm_test`, DIRECT_URL: `postgresql://postgres:${password}@127.0.0.1:55445/ls_salon_crm_test`, AUTH_SECRET: token(), DEMO_PASSWORD: token() }
    fs.writeFileSync(file, '# Local demo credentials only. Never use for hosted environments or commit this file.\n' + Object.entries(values).map(([key, value]) => `${key}=${value}`).join('\n') + '\n', { mode: 0o600, flag: 'wx' })
  }
  const values = dotenv.parse(fs.readFileSync(file)), runtime = localUrl(values.DATABASE_URL), owner = localUrl(values.DIRECT_URL)
  if (runtime.username !== 'crm_test_runtime' || owner.username !== 'postgres' || !/^[\w-]{25,}$/.test(values.LOCAL_DB_PASSWORD || '') || !/^[\w-]{25,}$/.test(values.DEMO_PASSWORD || '') || !values.AUTH_SECRET || decodeURIComponent(owner.password) !== values.LOCAL_DB_PASSWORD) throw Error('Invalid local demo configuration. No database was changed.')
  return { values, env: cleanEnv(values), runtime, owner }
}
async function setup() {
  const config = configuration()
  const inspect = spawnSync('docker', ['inspect', '--format', '{{index .Config.Labels "com.leiwissen.purpose"}}', 'ls-erp-local-demo-db'], { windowsHide: true, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
  if (inspect.status === 0 && inspect.stdout.trim() !== 'local-demo') throw Error('The local demo container name is already owned by another service.')
  await run('docker', [...compose, 'up', '-d', '--wait'], config.env, true)
  const db = new Client({ connectionString: config.values.DIRECT_URL }); await db.connect()
  try {
    const role = (await db.query("SELECT rolsuper,rolbypassrls,rolcreatedb,rolcreaterole FROM pg_roles WHERE rolname='crm_test_runtime'")).rows[0]
    if (role && Object.values(role).some(Boolean)) throw Error('The local runtime role has elevated privileges; refusing to start.')
    if (!role) {
      const statement = (await db.query("SELECT format('CREATE ROLE crm_test_runtime LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE PASSWORD %L', $1::text) sql", [decodeURIComponent(config.runtime.password)])).rows[0].sql
      await db.query(statement)
    }
    await db.query('ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT,INSERT,UPDATE,DELETE ON TABLES TO crm_test_runtime; ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE,SELECT ON SEQUENCES TO crm_test_runtime')
  } finally { await db.end() }
  await migrate(config.values.DIRECT_URL, { apply: true, env: config.env })
  await run(process.execPath, ['node_modules/prisma/build/index.js', 'generate'], config.env, true)
  const provision = new Client({ connectionString: config.values.DIRECT_URL }); await provision.connect()
  try {
    await provision.query('GRANT USAGE ON SCHEMA public,app TO crm_test_runtime; GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO crm_test_runtime; GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA public TO crm_test_runtime; REVOKE INSERT,UPDATE,DELETE ON _prisma_migrations FROM crm_test_runtime')
    // Same explicit runtime grant as the existing external-login local fixture.
    // Trigger/internal definer functions retain their restricted privileges.
    await provision.query('GRANT EXECUTE ON FUNCTION app.external_business_actor() TO crm_test_runtime')
    // Only the initial local control-plane identity needs direct bootstrap.
    // All demo business records/profiles/teams are created by the real APIs.
    await provision.query('BEGIN')
    await provision.query(`INSERT INTO "Tenant"(id,name,slug,"updatedAt") VALUES('local_demo_platform','Local demo platform','platform',now()) ON CONFLICT(id) DO NOTHING`)
    await provision.query(`INSERT INTO "User"(id,"tenantId",name,email,role,"passwordHash","updatedAt") VALUES('local_demo_platform_admin','local_demo_platform','Local platform admin','platform@local-demo.test','ADMIN',$1,now()) ON CONFLICT(id) DO NOTHING`, [await bcrypt.hash(config.values.DEMO_PASSWORD, 10)])
    await provision.query('COMMIT')
  } catch (error) { await provision.query('ROLLBACK'); throw error } finally { await provision.end() }
  fs.mkdirSync(directory, { recursive: true })
  fs.writeFileSync(path.join(directory, 'tsconfig.json'), JSON.stringify({ extends: '../../tsconfig.json', compilerOptions: { baseUrl: '../..', incremental: true }, include: ['../../next-env.d.ts', '../../**/*.ts', '../../**/*.tsx', './next/dev/types/**/*.ts'], exclude: ['../../node_modules', '../../test-results', '../../tmp', '../../playwright-report'] }, null, 2))
  return config
}
function info() { console.log('Local demo: http://demo.localhost:3109/crm/sales?view=team\nAdmin: admin@demo.test\nManagers: manager@demo.test, regional@demo.test\nStaff: staff1@demo.test through staff4@demo.test\nPassword: DEMO_PASSWORD in .env.local-demo\nCtrl+C stops the app; PostgreSQL data persists.') }
async function main(command = process.argv[2] || 'start') {
  if (command === 'stop-db') { configuration(); await run('docker', [...compose, 'stop'], process.env, true); return }
  if (command === 'info') { configuration(); info(); return }
  if (command === 'start') await new Promise((resolve, reject) => {
    const probe = net.createServer()
    probe.once('error', () => reject(Error('Port 3109 is in use. Stop the previous local app before starting another.')))
    probe.listen(3109, '127.0.0.1', () => probe.close(resolve))
  })
  const config = await setup()
  if (command === 'new-migration') {
    const name = process.argv[3]
    if (!name || !/^[a-z][a-z0-9_]{2,79}$/.test(name)) throw Error('Provide a migration name such as add_customer_reference.')
    await run(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'dev', '--create-only', '--skip-seed', '--skip-generate', '--name', name], { ...config.env, DATABASE_URL: config.values.DIRECT_URL, DIRECT_URL: config.values.DIRECT_URL })
    return
  }
  if (command === 'setup' || command === 'migrate') return
  if (command !== 'start') throw Error('Use start, setup, migrate, new-migration, info or stop-db.')
  const app = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'dev', '--webpack', '--hostname', '127.0.0.1', '--port', '3109'], { cwd: root, env: config.env, windowsHide: true, stdio: 'inherit' })
  let exited = false
  app.on('exit', code => { exited = true; if (code) process.exitCode = code })
  const stop = () => process.platform === 'win32' ? spawnSync('taskkill', ['/PID', String(app.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }) : app.kill()
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, stop)
  try {
    for (let attempt = 0; ; attempt++) {
      if (exited) throw Error('Local application did not start. Check that port 3109 is free.')
      try { if ((await fetch('http://127.0.0.1:3109/api/auth/csrf', { signal: AbortSignal.timeout(3000) })).ok) break } catch { /* wait for compilation */ }
      if (attempt >= 119) throw Error('Local application startup timed out.')
      await new Promise(resolve => setTimeout(resolve, 1000))
    }
    await require('./local-demo-data.cjs').seed(config)
    info()
  } catch (error) { stop(); throw error }
}
if (require.main === module) main().catch(error => { console.error(error.message.replace(/postgres(?:ql)?:\/\/\S+/g, '[database URL]')); process.exitCode = 1 })
module.exports = { cleanEnv, configuration, setup, main }
