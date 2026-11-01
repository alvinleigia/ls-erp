/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('node:fs')
const path = require('node:path')
const { createHash } = require('node:crypto')
const { spawn } = require('node:child_process')
const { Client } = require('pg')
const root = path.resolve(__dirname, '..')
const targets = {
  staging: { project: 'prj_zZjjsQX2pp1qVz7vE2FrmZWU8rM0', branch: 'staging', ref: 'oyhsrcmjhwxhvepdbcdc' },
  production: { project: 'prj_GZCH9YiGANSZ2FGdg50E1TbdGzsX', branch: 'main', ref: 'tehtbbifiimoplzlewzs' },
}
function localUrl(value) {
  const url = new URL(value)
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !['127.0.0.1', 'localhost'].includes(url.hostname) || url.port !== '55445' || url.pathname !== '/ls_salon_crm_test') throw Error('Local demo requires its dedicated loopback PostgreSQL database on port 55445.')
  return url
}
function hostedTarget(env) {
  const entry = Object.entries(targets).find(([, target]) => target.project === env.VERCEL_PROJECT_ID)
  if (!entry || env.VERCEL_ENV !== 'production' || env.VERCEL_GIT_COMMIT_REF !== entry[1].branch) throw Error('Database deployment requires the registered project, production target and matching Git branch.')
  return { name: entry[0], ...entry[1] }
}
function hostedUrl(value, target, migration = false) {
  const url = new URL(value)
  const direct = url.hostname === `db.${target.ref}.supabase.co`
  const pooled = /^(?:aws-\d+-[a-z0-9-]+)\.pooler\.supabase\.com$/.test(url.hostname) && decodeURIComponent(url.username).endsWith(`.${target.ref}`)
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || url.pathname !== '/postgres' || (!direct && !pooled)) throw Error('Database URL does not match the registered Supabase environment.')
  if (migration && url.port && url.port !== '5432') throw Error('Migrations require the direct or session connection on port 5432, not the runtime transaction pool.')
  return url
}
const hash = value => createHash('sha256').update(value).digest('hex')
function migrations(directory = path.join(root, 'prisma/migrations')) {
  return fs.readdirSync(directory, { withFileTypes: true }).filter(entry => entry.isDirectory()).sort((a, b) => a.name.localeCompare(b.name, 'en')).map(entry => {
    const sql = fs.readFileSync(path.join(directory, entry.name, 'migration.sql'), 'utf8')
    // Windows checkouts and Linux CI differ only in line endings. Accept both
    // byte forms; any SQL/content change still fails the immutable-history check.
    const lf = sql.replace(/\r\n/g, '\n')
    return { name: entry.name, checksums: new Set([hash(sql), hash(lf), hash(lf.replace(/\n/g, '\r\n'))]) }
  })
}
function checkHistory(files, history) {
  const active = history.filter(row => !row.rolled_back_at)
  if (active.some(row => !row.finished_at)) throw Error('An unfinished database migration needs explicit recovery; automatic deployment stopped.')
  const applied = new Set()
  for (const row of active) {
    const file = files.find(file => file.name === row.migration_name)
    if (!file || !file.checksums.has(row.checksum) || applied.has(row.migration_name)) throw Error('Applied migration history differs from this checkout; automatic deployment stopped.')
    applied.add(row.migration_name)
  }
  const pending = files.filter(file => !applied.has(file.name))
  if (pending.some(file => files.some(later => applied.has(later.name) && later.name > file.name))) throw Error('An older migration is missing from database history; automatic deployment stopped.')
  return pending.map(file => file.name)
}
async function history(url) {
  const db = new Client({ connectionString: url, connectionTimeoutMillis: 15000 })
  await db.connect()
  try {
    if (!(await db.query("SELECT to_regclass('public._prisma_migrations') AS table_name")).rows[0].table_name) {
      if ((await db.query("SELECT 1 FROM pg_tables WHERE schemaname='public' LIMIT 1")).rowCount) throw Error('A nonempty database has no Prisma history; refusing automatic baselining.')
      return []
    }
    return (await db.query('SELECT migration_name,checksum,finished_at,rolled_back_at FROM _prisma_migrations')).rows
  } finally { await db.end() }
}
function run(command, args, env = process.env, quiet = false) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, env, windowsHide: true, stdio: quiet ? 'ignore' : 'inherit' })
    child.on('error', () => reject(Error('Unable to start the required database command.')))
    child.on('close', code => code === 0 ? resolve() : reject(Error(`Database command failed (${code}); no reset or recovery was attempted.`)))
  })
}
async function migrate(url, { apply = false, env = process.env } = {}) {
  const files = migrations(), pending = checkHistory(files, await history(url))
  if (pending.length && !apply) throw Error(`${pending.length} pending migrations require the controlled production release before this build can proceed.`)
  if (pending.length) {
    console.log(`Applying ${pending.length} pending migrations.`)
    await run(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], { ...env, DATABASE_URL: url, DIRECT_URL: url }, true)
    if (checkHistory(files, await history(url)).length) throw Error('Migration verification failed after deployment.')
  }
  console.log(`Database migration history verified: ${files.length} applied; ${pending.length} newly applied.`)
  return { total: files.length, applied: pending.length }
}
module.exports = { root, targets, localUrl, hostedTarget, hostedUrl, migrations, checkHistory, migrate, run }
