/* eslint-disable @typescript-eslint/no-require-imports */
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { createHash } = require('node:crypto')
const { localUrl, hostedTarget, hostedUrl, targets, migrations, checkHistory } = require('../scripts/database-workflow.cjs')
const { cleanEnv } = require('../scripts/local-demo.cjs')
const env = { VERCEL_PROJECT_ID: targets.staging.project, VERCEL_ENV: 'production', VERCEL_GIT_COMMIT_REF: 'staging' }
const pool = (ref = targets.staging.ref) => `postgresql://postgres.${ref}:private@aws-1-ap-south-1.pooler.supabase.com:5432/postgres`

test('local demo accepts only the dedicated loopback database and port', () => {
  assert.equal(localUrl('postgresql://postgres@127.0.0.1:55445/ls_salon_crm_test').port, '55445')
  for (const value of ['postgresql://postgres@localhost:5432/ls_salon_crm_test', 'postgresql://postgres@localhost:55445/postgres', 'postgresql://postgres@localhost.evil.test:55445/ls_salon_crm_test', pool(), 'https://localhost:55445/ls_salon_crm_test']) assert.throws(() => localUrl(value))
})
test('hosted automation requires the exact registered staging project and Git branch', () => {
  assert.equal(hostedTarget(env).name, 'staging')
  for (const patch of [{ VERCEL_PROJECT_ID: '' }, { VERCEL_PROJECT_ID: targets.production.project }, { VERCEL_ENV: 'preview' }, { VERCEL_ENV: 'development' }, { VERCEL_GIT_COMMIT_REF: 'main' }, { VERCEL_GIT_COMMIT_REF: 'feature/test' }]) assert.throws(() => hostedTarget({ ...env, ...patch }))
})
test('production is recognized separately, never as the auto-apply staging target', () => {
  const target = hostedTarget({ VERCEL_PROJECT_ID: targets.production.project, VERCEL_ENV: 'production', VERCEL_GIT_COMMIT_REF: 'main' })
  assert.equal(target.name, 'production')
  assert.notEqual(target.name, 'staging')
})
test('hosted URLs cannot cross environment, spoof a pooler hostname or substitute another database', () => {
  assert.equal(hostedUrl(pool(), targets.staging).pathname, '/postgres')
  assert.equal(hostedUrl(`postgresql://postgres:private@db.${targets.staging.ref}.supabase.co:5432/postgres`, targets.staging).pathname, '/postgres')
  for (const value of [pool(targets.production.ref), pool().replace('.pooler.supabase.com', '.pooler.supabase.com.evil.test'), pool().replace(/\/postgres$/, '/other'), pool().replace(targets.staging.ref, targets.staging.ref + 'evil'), pool().replace('postgresql:', 'https:')]) assert.throws(() => hostedUrl(value, targets.staging))
  const transaction = pool().replace(':5432/', ':6543/')
  assert.equal(hostedUrl(transaction, targets.staging).port, '6543')
  assert.throws(() => hostedUrl(transaction, targets.staging, true))
})
const file = (name, sql) => ({ name, checksums: new Set([createHash('sha256').update(sql).digest('hex')]) })
const files = [file('001_initial', 'initial'), file('002_additive', 'additive')]
const row = (index, patch = {}) => ({ migration_name: files[index].name, checksum: [...files[index].checksums][0], finished_at: new Date(), rolled_back_at: null, ...patch })
test('migration history applies only pending committed migrations and treats an up-to-date database as a no-op', () => {
  assert.deepEqual(checkHistory(files, []), ['001_initial', '002_additive'])
  assert.deepEqual(checkHistory(files, [row(0)]), ['002_additive'])
  assert.deepEqual(checkHistory(files, [row(0), row(1)]), [])
})
test('failed migrations, edited SQL, missing files, duplicate history and out-of-order gaps fail closed', () => {
  for (const rows of [[row(0, { finished_at: null })], [row(0, { checksum: 'changed' })], [row(0, { migration_name: 'unknown' })], [row(0), row(0)], [row(1)]]) assert.throws(() => checkHistory(files, rows))
})
test('a deliberately rolled-back historical attempt does not hide the successful migration', () => {
  assert.deepEqual(checkHistory(files, [row(0, { finished_at: null, rolled_back_at: new Date() }), row(0)]), ['002_additive'])
})
test('the complete repository history has an immutable file and line-ending variants for every migration', () => {
  const history = migrations()
  assert(history.length >= 147)
  assert.equal(new Set(history.map(file => file.name)).size, history.length)
  assert(history.every(file => file.checksums.size >= 1 && [...file.checksums].every(sum => /^[a-f0-9]{64}$/.test(sum))))
})
test('local app subprocesses remove inherited hosted credentials and delivery settings', () => {
  const prior = { SUPABASE_SECRET_KEY: process.env.SUPABASE_SECRET_KEY, VERCEL_PROJECT_ID: process.env.VERCEL_PROJECT_ID }
  process.env.SUPABASE_SECRET_KEY = 'hosted-secret-test'; process.env.VERCEL_PROJECT_ID = targets.production.project
  try {
    const actual = cleanEnv({ DATABASE_URL: 'local', DIRECT_URL: 'local-owner', AUTH_SECRET: 'local-auth' })
    assert.equal(actual.SUPABASE_SECRET_KEY, '')
    assert.equal(actual.VERCEL_PROJECT_ID, '')
    assert.equal(actual.DATABASE_URL, 'local')
    assert.equal(actual.DIRECT_URL, 'local-owner')
    assert.equal(actual.APP_ROOT_DOMAIN, 'localhost')
  } finally { for (const [key, value] of Object.entries(prior)) { if (value === undefined) delete process.env[key]; else process.env[key] = value } }
})

test('the actual deployment hook auto-applies only staging and makes production check-only', async () => {
  const workflowPath = require.resolve('../scripts/database-workflow.cjs'), hookPath = require.resolve('../scripts/deployment-migrations.cjs')
  const original = require.cache[workflowPath].exports, before = { ...process.env }, calls = []
  require.cache[workflowPath].exports = { ...original, migrate: async (url, options) => { calls.push({ url, apply: options.apply }) } }
  delete require.cache[hookPath]
  try {
    const { main } = require(hookPath)
    for (const name of ['staging', 'production']) {
      Object.assign(process.env, { VERCEL: '1', VERCEL_PROJECT_ID: targets[name].project, VERCEL_ENV: 'production', VERCEL_GIT_COMMIT_REF: targets[name].branch, DATABASE_URL: pool(targets[name].ref), DIRECT_URL: pool(targets[name].ref), MIGRATION_DATABASE_URL: '' })
      await main()
    }
    assert.deepEqual(calls.map(call => call.apply), [true, false])
    Object.assign(process.env, env, { DATABASE_URL: pool(), DIRECT_URL: pool(targets.production.ref) })
    await assert.rejects(require(hookPath).main())
    assert.equal(calls.length, 2, 'A mismatched migration credential must never reach migration execution')
  } finally {
    require.cache[workflowPath].exports = original; delete require.cache[hookPath]
    for (const key of Object.keys(process.env)) if (!(key in before)) delete process.env[key]
    Object.assign(process.env, before)
  }
})
