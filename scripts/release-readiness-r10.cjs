/* eslint-disable @typescript-eslint/no-require-imports */
// R10 source/history checks. No dotenv loading, database connections or mutations.
const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const { sha, lf } = require('./industry-release.cjs')
const root = path.resolve(__dirname, '..')
const manifest = require('../docs/release-source-r10.json')

function verifySource(candidate = manifest, directory = root) {
  const migrationDir = path.join(directory, 'prisma/migrations')
  const names = fs.readdirSync(migrationDir).filter(name => fs.statSync(path.join(migrationDir, name)).isDirectory()).sort()
  if (candidate.format !== 1 || candidate.release !== 'R10' || JSON.stringify(names) !== JSON.stringify(candidate.migrations.map(m => m.name))) throw Error('R10 migration inventory differs from the reviewed source.')
  for (const m of candidate.migrations) {
    const sql = lf(fs.readFileSync(path.join(migrationDir, m.name, 'migration.sql')))
    if (sha(sql) !== m.sha256Lf || sha(sql.replaceAll('\n', '\r\n')) !== m.sha256Crlf) throw Error(`R10 migration checksum mismatch: ${m.name}`)
    if (m.sha256LfFinalCrlf && (!sql.endsWith('\n') || sha(sql.slice(0, -1) + '\r\n') !== m.sha256LfFinalCrlf)) throw Error(`Historical newline checksum mismatch: ${m.name}`)
  }
  if (sha(lf(fs.readFileSync(path.join(directory, 'prisma/schema.prisma')))) !== candidate.schemaSha256Lf) throw Error('R10 schema differs from the reviewed source.')
}

function historyProblems(rows, complete = true, candidate = manifest) {
  const errors = [], applied = new Set(), known = new Map(candidate.migrations.map(m => [m.name, m]))
  for (const row of rows) {
    const m = known.get(row.name)
    if (!m) { errors.push(`Unknown migration: ${row.name}`); continue }
    if (![m.sha256Lf, m.sha256Crlf, m.sha256LfFinalCrlf].filter(Boolean).includes(row.checksum)) errors.push(`Applied checksum mismatch: ${row.name}`)
    if (row.rolledBack) {
      if (row.finished) errors.push(`Conflicting rollback history: ${row.name}`)
      continue
    }
    if (!row.finished) errors.push(`Unfinished migration: ${row.name}`)
    if (applied.has(row.name)) errors.push(`Duplicate migration history: ${row.name}`)
    applied.add(row.name)
  }
  // A baseline must be a contiguous prefix, never a guessed count or a gap.
  const expected = complete ? candidate.migrations : candidate.migrations.slice(0, Math.max(-1, ...candidate.migrations.map((m, i) => applied.has(m.name) ? i : -1)) + 1)
  for (const m of expected) if (!applied.has(m.name)) errors.push(`Missing migration: ${m.name}`)
  return errors
}

function summarizeHistory(rows, candidate = manifest) {
  const problems = historyProblems(rows, false, candidate)
  if (problems.length) throw Error('Migration history is not a verified prefix: ' + problems.join('; '))
  const applied = new Set(rows.filter(r => r.finished && !r.rolledBack).map(r => r.name))
  return { historyRows: rows.length, appliedMigrations: applied.size, pendingMigrations: candidate.migrations.length - applied.size, rolledBackAttempts: rows.filter(r => r.rolledBack).length }
}

function receipt() {
  verifySource()
  const git = args => execFileSync('git', args, { cwd: root, windowsHide: true, encoding: 'utf8' }).trim()
  return {
    format: 1, release: 'R10', commit: git(['rev-parse', 'HEAD']), cleanWorktree: git(['status', '--porcelain']).length === 0,
    sourceManifestSha256: sha(fs.readFileSync(path.join(root, 'docs/release-source-r10.json'))), migrations: manifest.migrations.length,
    sourceVerified: true, hostedMigrationHistory: 'unverified', pilotRecovery: 'unverified', hostedAcceptance: 'unverified', releaseApproved: false,
  }
}

if (require.main === module) {
  try { console.log(JSON.stringify(receipt(), null, 2)) }
  catch (error) { console.error(error.message); process.exitCode = 1 }
}
module.exports = { verifySource, historyProblems, summarizeHistory, receipt }
