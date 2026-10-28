/* eslint-disable @typescript-eslint/no-require-imports */
// Source/history validation only. No dotenv, database or deployment operations.
const path=require('node:path'),fs=require('node:fs'),assert=require('node:assert/strict')
const history=require('./release-readiness-r10.cjs'),{sha,lf}=require('./industry-release.cjs')
const manifest=require('../docs/release-source-participants.json'),baseline=require('../docs/release-source-r10.json')
const root=path.resolve(__dirname,'..')
function verifySource(candidate=manifest,directory=root){
 history.verifySource(candidate,directory,'PARTICIPANTS')
 assert.equal(candidate.baseline.release,'R10');assert.equal(candidate.baseline.migrations,baseline.migrations.length)
 assert.equal(candidate.baseline.manifestSha256Lf,sha(lf(fs.readFileSync(path.join(directory,'docs/release-source-r10.json')))))
 assert.deepEqual(candidate.migrations.slice(0,baseline.migrations.length),baseline.migrations,'Previously released SQL/checksums changed')
 assert.equal(candidate.migrations.length-baseline.migrations.length,4)
}
const historyProblems=(rows,complete=true)=>history.historyProblems(rows,complete,manifest)
const summarizeHistory=rows=>history.summarizeHistory(rows,manifest)
module.exports={verifySource,historyProblems,summarizeHistory,manifest}
if(require.main===module){try{verifySource();console.log(JSON.stringify({release:manifest.release,migrations:manifest.migrations.length,baselineMigrations:manifest.baseline.migrations,sourceVerified:true,hostedHistoryVerified:false,pilotUpgradeVerified:false,releaseApproved:false}))}catch{console.error('Participant release source inventory failed.');process.exitCode=1}}
