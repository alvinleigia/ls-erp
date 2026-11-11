/* eslint-disable @typescript-eslint/no-require-imports */
const {test}=require('node:test'),assert=require('node:assert/strict')
const {verificationStatus}=require('../platform/verification/submission-status.ts')
const actor={tenantId:'t',userId:'u',role:'ADMIN'},now=new Date('2026-11-11T12:00:00Z')
function database(review,policy=1,latest={id:'latest',policyVersion:1}){let reads=0;return {get reads(){return reads},verificationSubmission:{async findFirst(){reads++;return latest}},verificationReview:{async findFirst({where}){assert.equal(where.submissionId,'latest');return review}},async $queryRaw(strings){return strings.join('').includes('statement_timestamp')?[{now}]:[{version:policy}]}}}
test('ordinary case readers receive no private revision queries or inferred review verdict',async()=>{
 const tx=database(null);assert.deepEqual(await verificationStatus(tx,{...actor,permissions:['customerVerification.read']},'case'),{status:'IN_PROGRESS',reviewStatusAvailable:false});assert.equal(tx.reads,0)
 assert.equal((await verificationStatus(tx,actor,undefined)).status,'NOT_STARTED');assert.equal(tx.reads,0)
})
test('approval expiry uses the database clock including the exact expiry boundary',async()=>{
 for(const [offset,status] of [[1,'VERIFIED'],[0,'EXPIRED'],[-1,'EXPIRED']])assert.equal((await verificationStatus(database({decision:'APPROVED',validUntil:new Date(+now+offset)}),actor,'case')).status,status)
 assert.equal((await verificationStatus(database({decision:'APPROVED',validUntil:null}),actor,'case')).status,'VERIFIED')
})
test('latest pending/corrected/revoked or outdated-policy revisions never fall back to an earlier approval',async()=>{
 for(const [review,status] of [[null,'UNDER_REVIEW'],[{decision:'CHANGES_REQUIRED'},'CHANGES_REQUIRED'],[{decision:'REVOKED'},'REVOKED']])assert.equal((await verificationStatus(database(review),actor,'case')).status,status)
 assert.equal((await verificationStatus(database({decision:'APPROVED',validUntil:null},2),actor,'case')).status,'REVIEW_REQUIRED')
 assert.equal((await verificationStatus(database(null,1,null),actor,'case')).status,'IN_PROGRESS')
})
