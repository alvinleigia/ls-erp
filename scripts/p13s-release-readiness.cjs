/* eslint-disable @typescript-eslint/no-require-imports */
// P13S source/history validation and reviewed access proposals only.
// Never loads dotenv, connects to a database, changes permissions or deploys.
const path=require('node:path'),assert=require('node:assert/strict')
const history=require('./release-readiness-r10.cjs'),{sha}=require('./industry-release.cjs')
const manifest=require('../docs/release-source-p13s.json'),released=require('../docs/release-source-p13.json')
const partnerPermissions=Object.freeze(['partnerChoices.read','partnerLinks.read','partnerLinks.create','partnerLinks.edit'])
function verifySource(candidate=manifest,directory=path.resolve(__dirname,'..')){
 history.verifySource(candidate,directory,'P13S')
 assert.equal(candidate.baseline.commit,'b28223f0f2be5f1ed5fe166a45a98b1810d5ce7d')
 assert.equal(candidate.baseline.migrations,150);assert.equal(candidate.migrations.length,157)
 assert.equal(candidate.baseline.inventorySha256,sha(JSON.stringify(candidate.migrations.slice(0,150))))
 assert.deepEqual(candidate.migrations.slice(0,released.migrations.length),released.migrations,'Earlier release checksums changed')
 assert.deepEqual(candidate.migrations.slice(150).map(m=>m.name),[
  '20261110000100_delegated_partner_links','20261110000200_customer_verification_foundation',
  '20261111000100_verification_private_evidence','20261111000200_verification_submission_review',
  '20261111000300_verification_checkpoints','20261111000400_verification_retention_holds',
  '20261111000500_verification_controlled_disposal',
 ])
}
const historyProblems=(rows,complete=true)=>history.historyProblems(rows,complete,manifest)
const summarizeHistory=rows=>history.summarizeHistory(rows,manifest)
function proposePartnerAccess(profile,policy,roleIds){
 assert(profile&&profile.id&&profile.version>0&&!profile.archived&&profile.moduleKey==='all','Use the active composed collections profile')
 assert(policy&&policy.version>0&&policy.rules&&Array.isArray(roleIds)&&roleIds.includes(profile.id),'Review the existing user policy and assignments')
 assert(Array.isArray(profile.permissions)&&['opportunities.read','opportunities.create','opportunities.edit'].every(p=>profile.permissions.includes(p)),'Keep the parent opportunity permissions explicit')
 const permissions=[...profile.permissions],rules={...policy.rules},addedPermissions=[],changedRules=[]
 for(const p of partnerPermissions){if(!permissions.includes(p)){permissions.push(p);addedPermissions.push(p)}if(rules[p]!=='ALL'){changedRules.push(p);rules[p]='ALL'}}
 return{
  role:{id:profile.id,body:{version:profile.version,name:profile.name,moduleKey:profile.moduleKey,permissions,archived:false}},
  assignment:{body:{version:policy.version,roleIds:[...roleIds],rules}},
  addedPermissions,changedRules,roleNeedsUpdate:addedPermissions.length>0,policyNeedsUpdate:changedRules.length>0,
  preservesExistingSalesScopes:true,kycGrantsAdded:false,applied:false,
 }
}
// Existing profile actions only. No new administrative, deletion, refund or KYC
// authority is added by selecting central collections scope.
const centralCollectionsScopes=Object.freeze([
 'contacts.read','contacts.edit','accounts.read','projects.read','teams.read','assignmentTargets.read',
 'opportunities.read','opportunities.edit','opportunities.assign','opportunities.export',
 'quotations.read','quotations.edit','quotations.export','salesOrders.read','salesOrders.confirm',
 'receivables.read','receivables.create','orderPayments.read','orderPayments.create',
 'orderDocuments.read','orderDocuments.create','orderDocuments.export',
 'paymentDocuments.read','paymentDocuments.create','paymentDocuments.export',
 'unitReservations.read','unitReservations.create','unitReservations.confirm',
])
function proposeCentralCollectionsAccess(profile,policy,roleIds){
 const p=proposePartnerAccess(profile,policy,roleIds)
 for(const key of centralCollectionsScopes)if(profile.permissions.includes(key)&&p.assignment.body.rules[key]!=='ALL'){p.assignment.body.rules[key]='ALL';p.changedRules.push(key)}
 return {...p,policyNeedsUpdate:p.changedRules.length>0,preservesExistingSalesScopes:false,preservesOfficeMemberships:true,preservesRestrictedVisibility:true,scopeMode:'ALL_ACCESSIBLE_SALES'}
}
module.exports={manifest,verifySource,historyProblems,summarizeHistory,partnerPermissions,proposePartnerAccess,centralCollectionsScopes,proposeCentralCollectionsAccess}
if(require.main===module){try{verifySource();console.log(JSON.stringify({release:'P13S',sourceVerified:true,migrations:157,baselineMigrations:150,addedMigrations:7,hostedHistoryVerified:false,recoveryVerified:false,releaseApproved:false}))}catch{console.error('P13S source verification failed.');process.exitCode=1}}
