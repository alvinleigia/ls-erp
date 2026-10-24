/* eslint-disable @typescript-eslint/no-require-imports */
const {test}=require('node:test'),assert=require('node:assert/strict')
const {allPermissions,resourceKeys}=require('../platform/access/catalog.ts')
const {defaultRecordRules,recordLimits,recordScope,recordRulesSchema,supportedScopes}=require('../platform/access/rules.ts')
const {authorizeOperation}=require('../platform/access/policy.ts')
const {ownedRecordScope}=require('../platform/access/record-scope.ts')
const {projectScope}=require('../modules/real-estate/access.ts')
const {leaveApprovalScope}=require('../modules/workforce/leave-access.ts')
const {recordActionAccess}=require('../platform/access/record-actions.ts')
const {BusinessError}=require('../platform/policy.ts')
const {optionalReference}=require('../platform/access/reference.ts')
const actor={tenantId:'a',userId:'u',role:'STAFF',recordRules:defaultRecordRules(),permissions:allPermissions,managedTeamIds:['t'],memberTeamIds:['t']}
test('every resource has validated defaults; undefined or invalid policy entries deny access',()=>{
 assert.equal(Object.keys(defaultRecordRules()).length,allPermissions.length);recordRulesSchema.parse(defaultRecordRules())
 assert.equal(recordScope({...actor,recordRules:{}},'inventoryProducts'),'NONE')
 assert.equal(recordScope({...actor,recordRules:{'inventoryProducts.read':'FAKE'}},'inventoryProducts'),'NONE')
 assert.throws(()=>recordRulesSchema.parse({'inventoryProducts.read':'MANAGED_TEAMS'}))
 assert.throws(()=>recordRulesSchema.parse({'fake.read':'ALL'}))
 for(const resource of resourceKeys)assert.ok(supportedScopes(resource).includes('NONE'))
})
test('Staff and Manager labels use identical policies; Admin remains the security administrator',()=>{
 for(const resource of resourceKeys)assert.deepEqual(recordLimits(actor,resource),recordLimits({...actor,role:'MANAGER'},resource))
 assert.deepEqual(recordLimits({...actor,role:'ADMIN',recordRules:{}},'projects','edit'),[])
})
test('read all/edit own is enforced and broad edits can never bypass a narrow read scope',()=>{
 const a={...actor,recordRules:{'enquiries.read':'ALL','enquiries.edit':'OWN','enquiries.assign':'NONE'}}
 assert.deepEqual(ownedRecordScope(authorizeOperation(a,'enquiries.read'),'enquiries').AND,[])
 assert.deepEqual(recordLimits(a,'enquiries','edit'),['OWN']);assert.deepEqual(recordLimits(a,'enquiries','assign'),['NONE'])
 assert.deepEqual(recordLimits({...a,recordRules:{'enquiries.read':'OWN','enquiries.edit':'ALL'}},'enquiries','edit'),['OWN'])
})
test('operation context does not change related read lookups; project scope intersections are not ranked',()=>{
 const a=authorizeOperation({...actor,recordRules:{...actor.recordRules,'projects.read':'ASSIGNED','projects.edit':'OWN'}},'projects.edit')
 assert.deepEqual(recordLimits(a,'projects'),['OWN','ASSIGNED']);assert.equal(projectScope(a).OR.length,2)
 assert.equal(recordScope(a,'contacts'),'RELATED')
 assert.equal(recordScope(a,'projects','read'),'ASSIGNED')
})
test('leave authority uses configured routing and reporting relationships, independently of sales teams',()=>{
 const a={...actor,recordRules:{'leaveApprovals.read':'ALL','leaveApprovals.approve':'REPORTS'}}
 const scope=leaveApprovalScope(a,'approve');assert.equal(scope.staffProfile.leaveApprovalMode,'REPORTING_MANAGER')
 assert.equal(scope.staffProfile.userId.not,'u');assert.deepEqual(scope.staffProfile.AND,[{managerUserId:'u'}])
 assert.deepEqual(leaveApprovalScope({...a,managedTeamIds:['other']},'approve'),scope)
})

test('record action metadata uses the same intersected scopes and fails closed for hidden records',async()=>{
 const tx={$queryRaw:async()=>[{allowed:true}]}
 const a={...actor,recordRules:{'enquiries.read':'ALL','enquiries.edit':'OWN','enquiries.assign':'NONE'}}
 const probed=[]
 const access=await recordActionAccess(a,'enquiries','e',tx,async action=>{probed.push(action);throw new BusinessError(404,'Not found')})
 assert.equal(access.permissions['enquiries.read'],true)
 assert.equal(access.permissions['enquiries.edit'],false)
 assert.equal(access.permissions['enquiries.assign'],false)
 assert.deepEqual(probed,['edit'])
 const own=await recordActionAccess(a,'enquiries','e',tx,async()=>({id:'own'}))
 assert.equal(own.permissions['enquiries.edit'],true)
 const noGrant=await recordActionAccess({...a,permissions:['enquiries.read']},'enquiries','e',tx,async()=>{throw new Error('Unexpected probe')})
 assert.equal(noGrant.permissions['enquiries.edit'],false)
 await assert.rejects(()=>recordActionAccess(a,'enquiries','e',tx,async()=>{throw new Error('Database unavailable')}),/Database unavailable/)
})

test('optional reference access never blocks a primary record or grants lookup authority',async t=>{
 const original=global.fetch;t.after(()=>{global.fetch=original});let calls=0
 global.fetch=async()=>{calls++;return new Response('{}',{status:403})}
 assert.equal(await optionalReference('/directory',false),null);assert.equal(calls,0)
 assert.equal(await optionalReference('/directory',true),null);assert.equal(calls,1)
 global.fetch=async()=>new Response('{"error":"Reference unavailable"}',{status:500})
 await assert.rejects(optionalReference('/directory',true),/Reference unavailable/)
 global.fetch=async()=>new Response('{"currentUserId":"u"}',{status:200})
 assert.deepEqual(await optionalReference('/directory',true),{currentUserId:'u'})
})
