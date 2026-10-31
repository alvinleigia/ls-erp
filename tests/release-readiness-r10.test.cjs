/* eslint-disable @typescript-eslint/no-require-imports */
const reviewedSource = require('./helpers/reviewed-release-source.cjs')
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { verifySource, historyProblems, summarizeHistory, receipt } = require('../scripts/release-readiness-r10.cjs')
const { sha } = require('../scripts/industry-release.cjs')
const manifest = require('../docs/release-source-r10.json')
const history = () => manifest.migrations.map(m => ({ name: m.name, checksum: m.sha256Lf, finished: true, rolledBack: false }))

test('R10 pins its reviewed source while preserving historical checksums', t => {
  const source = reviewedSource(t, '321b171abf1c6167204809e3ef25b44e8bd28c87')
  verifySource(manifest, source)
  assert.equal(manifest.migrations.length, 132)
  for (const old of require('../docs/industry-release-manifest.json').migrations) {
    const current = manifest.migrations.find(m => m.name === old.name)
    for (const field of ['sha256Lf', 'sha256Crlf', 'sha256LfFinalCrlf']) assert.equal(current[field], old[field])
  }
  for (const mutate of [m => m.migrations.pop(), m => m.migrations.reverse(), m => { m.migrations[0].sha256Lf = 'bad' }, m => { m.schemaSha256Lf = 'bad' }, m => { m.migrations.find(i => i.sha256LfFinalCrlf).sha256LfFinalCrlf = 'bad' }]) {
    const changed = structuredClone(manifest); mutate(changed); assert.throws(() => verifySource(changed, source))
  }
})

test('source verification catches a changed SQL file, extra directory and schema', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ls-erp-release-source-'))
  t.after(() => {
    assert.equal(path.dirname(path.resolve(dir)), path.resolve(os.tmpdir()))
    assert.match(path.basename(dir), /^ls-erp-release-source-/)
    fs.rmSync(dir, { recursive: true, force: true })
  })
  const migration = '20260101000000_example', sql = 'SELECT 1;\n', schema = '// synthetic schema\n'
  const candidate = { format: 1, release: 'R10', schemaSha256Lf: sha(schema), migrations: [{ name: migration, sha256Lf: sha(sql), sha256Crlf: sha(sql.replaceAll('\n', '\r\n')) }] }
  fs.mkdirSync(path.join(dir, 'prisma/migrations', migration), { recursive: true })
  fs.writeFileSync(path.join(dir, 'prisma/schema.prisma'), schema)
  const file = path.join(dir, 'prisma/migrations', migration, 'migration.sql')
  fs.writeFileSync(file, sql); verifySource(candidate, dir)
  fs.writeFileSync(file, 'SELECT 2;\n'); assert.throws(() => verifySource(candidate, dir), /checksum/)
  fs.writeFileSync(file, sql); fs.writeFileSync(path.join(dir, 'prisma/schema.prisma'), '// changed')
  assert.throws(() => verifySource(candidate, dir), /schema/)
  fs.mkdirSync(path.join(dir, 'prisma/migrations/unknown')); assert.throws(() => verifySource(candidate, dir), /inventory/)
})

test('history validation rejects unknown, unfinished, duplicate, altered and missing migrations', () => {
  assert.deepEqual(historyProblems(history()), [])
  for (const mutate of [r => r.pop(), r => r.push(r[0]), r => { r[0].finished = false }, r => { r[0].checksum = 'bad' }, r => r.push({ name: 'unknown', rolledBack: true }), r => { r[0].rolledBack = true }]) {
    const changed = history(); mutate(changed); assert.ok(historyProblems(changed).length)
  }
  const alternate = history()
  for (const row of alternate) { const m = manifest.migrations.find(m => m.name === row.name); row.checksum = m.sha256LfFinalCrlf || m.sha256Crlf }
  assert.deepEqual(historyProblems(alternate), [])
})

test('a baseline must be a contiguous verified prefix; rollback does not apply a migration', () => {
  assert.deepEqual(historyProblems(history().slice(0, 111), false), [])
  assert.deepEqual(historyProblems([], false), []) // Unknown/empty baseline is not release approval.
  const gap = history().slice(0, 111); gap.splice(35, 1)
  assert.match(historyProblems(gap, false).join(), /Missing migration/)
  const rolled = { ...history()[0], finished: false, rolledBack: true }
  assert.deepEqual(historyProblems([rolled, ...history()]), [])
  assert.match(historyProblems([rolled]).join(), /Missing migration/)
})

test('historical source receipts fail closed when the current source has advanced', () => {
  assert.throws(() => receipt(), /inventory|schema/)
})

test('history summaries count applied migrations separately from rolled-back attempts', () => {
  const rows = history().slice(0, 107)
  rows.push({ ...rows.at(-1), finished: false, rolledBack: true })
  assert.deepEqual(summarizeHistory(rows), { historyRows: 108, appliedMigrations: 107, pendingMigrations: 25, rolledBackAttempts: 1 })
  assert.throws(() => summarizeHistory(rows.slice(1)), /verified prefix/)
  assert.throws(() => summarizeHistory([...rows, rows[0]]), /verified prefix/)
})
