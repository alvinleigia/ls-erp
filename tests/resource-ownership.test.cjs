/* eslint-disable @typescript-eslint/no-require-imports */
const {test}=require('node:test'),assert=require('node:assert/strict')
const {Prisma}=require('@prisma/client')
const {resourceKeys,allPermissions}=require('../platform/access/catalog.ts')
const {resourceRegistry,ownershipParts,infrastructureModels,ownershipDescription}=require('../platform/access/resource-registry.ts')
const {resourceRecordPolicies}=require('../platform/access/resource-policy.ts')
const {sharingRecords,sharingResource}=require('../platform/access/sharing-registry.ts')
const {auditFamilies}=require('../platform/audit/registry.ts')
const {recordScope,defaultRecordRules,supportedScopes,scopeNames}=require('../platform/access/rules.ts')
const baseline=require('./fixtures/resource-contract-baseline.json')

test('every permission resource and schema model has an explicit ownership classification',()=>{
 assert.deepEqual(Object.keys(resourceRegistry).sort(),[...resourceKeys].sort())
 const models=new Map(Prisma.dmmf.datamodel.models.map(model=>[model.name,model])),covered=new Set(Object.keys(infrastructureModels))
 for(const resource of resourceKeys){
  assert.ok(ownershipDescription(resource).length>20,resource)
  for(const part of ownershipParts(resource)){
   assert.ok(part.roots.length,resource)
   for(const name of [...part.roots,...(part.children??[])]){assert.ok(models.has(name),resource+': '+name);covered.add(name)}
   for(const source of part.sources??[])assert.ok(Object.hasOwn(resourceRegistry,source),resource+': '+source)
   if(part.kind==='office')for(const name of part.roots){const office=models.get(name).fields.find(field=>field.name==='officeId');assert.ok(office&&office.type==='String',name)}
  }
 }
 assert.deepEqual([...covered].sort(),[...models.keys()].sort())
 for(const name of Object.keys(infrastructureModels))assert.ok(!resourceKeys.some(key=>ownershipParts(key).some(part=>[...part.roots,...(part.children??[])].includes(name))),name)
})
test('consolidation preserves the reviewed scope families, sharing owners and composed audit requirements',()=>{
 for(const [resource,policy]of Object.entries(baseline.recordPolicies))assert.equal(resourceRecordPolicies[resource],policy,resource)
 assert.deepEqual(sharingRecords,baseline.sharingRecords)
 for(const [resource,owner]of Object.entries(baseline.sharingOwners))assert.equal(sharingResource(resource)??null,owner,resource)
 assert.deepEqual(auditFamilies,baseline.auditFamilies)
 for(const resource of resourceKeys){const contract=resourceRegistry[resource];if(contract.sharing){assert.ok(Object.hasOwn(sharingRecords,contract.sharing),resource);assert.equal(sharingResource(resource),contract.sharing)}}
 for(const resource of ['missing','__proto__','constructor','toString'])assert.equal(sharingResource(resource),undefined)
})
test('split stock/catalog/roster records and canonical financial ancestry stay distinct',()=>{
 const products=resourceRegistry.inventoryProducts.ownership
 assert.equal(products.kind,'split');assert.equal(products.parts.catalog.kind,'shared');assert.equal(products.parts.stock.kind,'office')
 assert.deepEqual(products.parts.bookings.sources,['appointments']);assert.deepEqual(products.parts.receipts.sources,['inventoryPurchases'])
 assert.deepEqual(resourceRegistry.unitReservations.ownership.sources,['salesOrders','catalogItems'])
 assert.deepEqual(resourceRegistry.quotations.ownership.sources,['opportunities']);assert.deepEqual(resourceRegistry.salesOrders.ownership.sources,['quotations'])
 assert.equal(resourceRegistry.shiftTemplates.ownership.kind,'shared');assert.equal(resourceRegistry.shiftSchedules.ownership.kind,'office')
 assert.equal(resourceRegistry.shiftRoster.ownership.parts.history.kind,'personal');assert.equal(resourceRegistry.shiftRoster.ownership.parts.browse.kind,'composed')
})
test('ownership registration does not grant actions, broaden scopes or turn source links into parent browse requirements',()=>{
 const actor={tenantId:'t',userId:'u',role:'MANAGER',permissions:[],recordRules:{}}
 for(const resource of resourceKeys){assert.equal(recordScope(actor,resource),'NONE');assert.ok(supportedScopes(resource).includes('NONE'))}
 const defaults=defaultRecordRules();assert.equal(Object.keys(defaults).length,allPermissions.length)
 for(const resource of resourceKeys)assert.ok(supportedScopes(resource).includes(defaults[resource+'.read']),resource)
 assert.equal(defaults['leaveRequests.read'],'OWN');assert.equal(defaults['leaveApprovals.read'],'REPORTS');assert.equal(defaults['auditLogs.read'],'BUSINESS')
 assert.equal(scopeNames.ALL,'All accessible records')
})
