/* eslint-disable @typescript-eslint/no-require-imports */
const { test } = require('node:test'), assert = require('node:assert/strict')
const { manifest, verifySource, historyProblems, summarizeHistory } = require('../scripts/p13-release-readiness.cjs')
const rows = () => manifest.migrations.map(m => ({ name: m.name, checksum: m.sha256Lf, finished: true, rolledBack: false }))
test('P13 pins the current schema and eleven migrations while preserving released SQL', () => {
  verifySource(); assert.equal(manifest.migrations.length, 147)
  for (const change of [m => m.migrations.reverse(), m => m.migrations.pop(), m => { m.schemaSha256Lf = 'bad' }, m => { m.baseline.manifestSha256Lf = 'bad' }, m => { m.migrations[136].sha256Lf = 'bad' }]) {
    const candidate = structuredClone(manifest); change(candidate); assert.throws(() => verifySource(candidate))
  }
})
test('P13 history requires all eleven migrations without rewriting rolled-back attempts', () => {
  const before = rows().slice(0, 136); before.push({ ...before[106], finished: false, rolledBack: true })
  assert.deepEqual(summarizeHistory(before), { historyRows: 137, appliedMigrations: 136, pendingMigrations: 11, rolledBackAttempts: 1 })
  assert.deepEqual(historyProblems(before, false), []); assert.equal(historyProblems(before).length, 11)
  assert.deepEqual(summarizeHistory([...before, ...rows().slice(136)]), { historyRows: 148, appliedMigrations: 147, pendingMigrations: 0, rolledBackAttempts: 1 })
  for (const invalid of [before.slice(1), [...before, before[0]], [...before, { ...rows()[136], finished: false }], [...before, { ...rows()[136], checksum: 'bad' }]]) assert.throws(() => summarizeHistory(invalid))
})
