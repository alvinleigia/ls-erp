/* eslint-disable @typescript-eslint/no-require-imports */
const {test}=require('node:test'),assert=require('node:assert/strict')
const {verifySource,summarizeHistory,historyProblems,manifest}=require('../scripts/participant-release-readiness.cjs')
const released=require('../docs/release-source-r10.json')
const rows=()=>manifest.migrations.map(m=>({name:m.name,checksum:m.sha256Lf,finished:true,rolledBack:false}))
test('participant candidate pins four new migrations without changing the released R10 inventory',()=>{
 verifySource();assert.equal(manifest.migrations.length,136);assert.deepEqual(manifest.migrations.slice(0,132),released.migrations)
 for(const change of [m=>m.migrations.reverse(),m=>m.migrations.pop(),m=>{m.schemaSha256Lf='bad'},m=>{m.baseline.manifestSha256Lf='bad'},m=>{m.migrations[132].sha256Lf='bad'}]){const candidate=structuredClone(manifest);change(candidate);assert.throws(()=>verifySource(candidate))}
})
test('observed 132-migration baseline preserves rolled-back attempts and requires all four candidate migrations',()=>{
 const source=rows().slice(0,132);source.push({...source[106],finished:false,rolledBack:true})
 assert.deepEqual(summarizeHistory(source),{historyRows:133,appliedMigrations:132,pendingMigrations:4,rolledBackAttempts:1})
 assert.deepEqual(historyProblems(source,false),[]);assert.equal(historyProblems(source,true).length,4)
 const after=[...source,...rows().slice(132)];assert.deepEqual(summarizeHistory(after),{historyRows:137,appliedMigrations:136,pendingMigrations:0,rolledBackAttempts:1})
 for(const invalid of [source.slice(1),[...source,source[0]],[...source,{...rows()[132],finished:false}],[...source,{...rows()[132],checksum:'bad'}]])assert.throws(()=>summarizeHistory(invalid))
})
