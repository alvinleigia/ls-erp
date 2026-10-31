/* eslint-disable @typescript-eslint/no-require-imports */
const reviewedSource = require('./helpers/reviewed-release-source.cjs')
const { test } = require('node:test')
const assert = require('node:assert/strict')
const manifest = require('../docs/industry-release-manifest.json')
const { verifySource, localUrl, outputPath, migrationProblems, compare, sha, lf } = require('../scripts/industry-release.cjs')
const history = phase => manifest.migrations.filter(m => phase === 'after' || m.phase === 'baseline').map(m => ({ name: m.name, checksum: m.sha256Lf, finished: true, rolledBack: false }))
const partition = { 'tenant:a': { count: 1, ids: 'identity', content: 'content' } }
function pair() {
  const before = { format: 2, serverMajor: '16', schemaObjects: {}, financialTotals: {}, foreignKeyViolations: [], migrations: history('before'), tables: Object.fromEntries(manifest.baselineTables.map(name => [name, { indexes: [], partitions: structuredClone(partition) }])) }
  before.tables.ShiftSchedule.indexes = [{ name: 'ShiftSchedule_default_unique', definition: manifest.previousShiftDefaultIndexDefinition }]
  const after = structuredClone(before)
  after.migrations = history('after')
  after.tables.ShiftSchedule.indexes = [{ name: 'ShiftSchedule_tenant_default_unique', definition: manifest.shiftDefaultIndexDefinition }]
  for (const [name, schema] of Object.entries(manifest.addedTables)) after.tables[name] = { ...structuredClone(schema), partitions: {} }
  return { before, after }
}
test('manifest matches source and detects edited migration/schema checksums', t => {
  const source = reviewedSource(t, '740cfc527a47aae55b397c5572fde080500e42b5')
  verifySource(manifest, source)
  const altered = structuredClone(manifest); altered.migrations[0].sha256Lf = 'bad'
  assert.throws(() => verifySource(altered, source), /checksum/)
  assert.throws(() => verifySource({ ...manifest, schemaSha256Lf: 'bad' }, source), /Schema/)
  assert.equal(sha(lf('SQL\r\n')), sha('SQL\n'))
})
test('rehearsal database and output paths cannot target hosted services or overwrite source', () => {
  assert.match(localUrl('postgresql://postgres@127.0.0.1:55440/ls_erp_rehearsal'), /rehearsal/)
  for (const input of ['postgresql://db.example/ls_erp_rehearsal', 'postgresql://localhost/production', 'postgresql://localhost/ls_erp_rehearsal?host=db.example', 'https://localhost/ls_erp_rehearsal', undefined]) assert.throws(() => localUrl(input))
  for (const file of ['../secret.json', '../../package.json', 'other.txt', '']) assert.throws(() => outputPath(file))
  assert.match(outputPath('before.json'), /tmp.*industry-release.*before.json$/)
})
test('migration history rejects unknown, unfinished, missing, modified and repeated migrations', () => {
  const rows = history('before')
  assert.deepEqual(migrationProblems(rows, manifest, 'before'), [])
  assert.ok(migrationProblems(rows.slice(1), manifest, 'before').some(e => e.startsWith('Missing')))
  assert.ok(migrationProblems([...rows, rows[0]], manifest, 'before').some(e => e.startsWith('Duplicate')))
  const bad = structuredClone(rows); bad[0].finished = false; bad[0].checksum = 'bad'
  assert.equal(migrationProblems(bad, manifest, 'before').length, 2)
  assert.ok(migrationProblems([...rows, { name: 'unexpected' }], manifest, 'before').some(e => e.startsWith('Unknown')))
  const crlf = structuredClone(rows); crlf[0].checksum = manifest.migrations[0].sha256Crlf
  assert.deepEqual(migrationProblems(crlf, manifest, 'before'), [])
})

test('reviewed mixed-newline history is proven from unchanged SQL, not an arbitrary exception', t => {
  const source = reviewedSource(t, '740cfc527a47aae55b397c5572fde080500e42b5')
  const mixed = manifest.migrations.filter(m => m.sha256LfFinalCrlf)
  assert.equal(mixed.length, 12)
  const rows = history('before')
  for (const m of mixed) rows.find(r => r.name === m.name).checksum = m.sha256LfFinalCrlf
  assert.deepEqual(migrationProblems(rows, manifest, 'before'), [])
  verifySource(manifest, source)
  const changed = structuredClone(manifest)
  changed.migrations.find(m => m.sha256LfFinalCrlf).sha256LfFinalCrlf = sha('different SQL\r\n')
  assert.throws(() => verifySource(changed, source), /Historical newline checksum mismatch/)
  rows.find(r => r.name === mixed[0].name).checksum = mixed[1].sha256LfFinalCrlf
  assert.ok(migrationProblems(rows, manifest, 'before').some(e => e === `Applied checksum mismatch: ${mixed[0].name}`))
  const missing = history('before'); delete missing[0].checksum
  assert.ok(migrationProblems(missing, manifest, 'before').some(e => e.startsWith('Applied checksum mismatch')))
})
test('only the reviewed two schema changes pass reconciliation', () => {
  const { before, after } = pair()
  assert.deepEqual(compare(before, after, manifest), [])
  const cases = [
    a => { a.format = 1 },
    a => { a.tables.CrmContact.partitions['tenant:a'].ids = 'other-id' },
    a => { a.tables.CrmQuotationRevision.partitions['tenant:a'].content = 'changed snapshot' },
    a => { a.tables.CrmContact.partitions['tenant:b'] = a.tables.CrmContact.partitions['tenant:a']; delete a.tables.CrmContact.partitions['tenant:a'] },
    a => { a.tables.User.rls = false },
    a => { a.financialTotals = { changed: true } },
    a => { a.schemaObjects = { changed: true } },
    a => { a.tables.TenantTerminology.partitions = partition },
    a => { a.tables.TenantTerminology.force = false },
    a => { a.tables.ShiftSchedule.indexes[0].definition = 'wrong index' },
    a => { delete a.tables.CrmContact },
    a => { a.tables.Unknown = { partitions: {} } },
    a => { a.foreignKeyViolations = [{ name: 'orphan', count: '1' }] },
  ]
  for (const mutate of cases) { const changed = structuredClone(after); mutate(changed); assert.ok(compare(before, changed, manifest).length) }
  delete before.tables.User; delete after.tables.User
  assert.ok(compare(before, after, manifest).some(e => e.includes('Missing baseline table: User')))
})
