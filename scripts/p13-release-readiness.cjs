/* eslint-disable @typescript-eslint/no-require-imports */
// Read-only source/history gate; this never certifies deployment or legal acceptance.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict')
const history = require('./release-readiness-r10.cjs'), { sha, lf } = require('./industry-release.cjs')
const manifest = require('../docs/release-source-p13.json'), baseline = require('../docs/release-source-participants.json')
function verifySource(candidate = manifest, directory = path.resolve(__dirname, '..')) {
  history.verifySource(candidate, directory, 'P13')
  assert.equal(candidate.baseline.release, 'PARTICIPANTS')
  assert.equal(candidate.baseline.migrations, baseline.migrations.length)
  assert.equal(candidate.baseline.manifestSha256Lf, sha(lf(fs.readFileSync(path.join(directory, 'docs/release-source-participants.json')))))
  assert.deepEqual(candidate.migrations.slice(0, baseline.migrations.length), baseline.migrations, 'Previously released SQL/checksums changed')
  assert.equal(candidate.migrations.length - baseline.migrations.length, 11)
}
const historyProblems = (rows, complete = true) => history.historyProblems(rows, complete, manifest)
const summarizeHistory = rows => history.summarizeHistory(rows, manifest)
module.exports = { manifest, verifySource, historyProblems, summarizeHistory }
if (require.main === module) {
  try { verifySource(); console.log(JSON.stringify({ release: 'P13', sourceVerified: true, migrations: manifest.migrations.length, baselineMigrations: baseline.migrations.length, hostedHistoryVerified: false, recoveryVerified: false, releaseApproved: false })) }
  catch { console.error('P13 source inventory failed.'); process.exitCode = 1 }
}
