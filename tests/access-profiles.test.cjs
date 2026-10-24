/* eslint-disable @typescript-eslint/no-require-imports */
const {test}=require('node:test'),assert=require('node:assert/strict')
const {composeProfilePermissions,moduleProfileTemplates,validProfilePermissions}=require('../platform/access/profiles.ts')
const {allPermissions,accessResources}=require('../platform/access/catalog.ts')
const {recordScope}=require('../platform/access/rules.ts')
const {accessRoleSchema,roleAssignmentSchema}=require('../platform/access/validation.ts')
const grant=(id,permissions,archived=false)=>({roleId:id,role:{archived,permissions}})
test('profile grants union actions, deduplicate overlap and ignore archived or unknown grants',()=>{
 const grants=[grant('a',['dashboard.read','enquiries.read','enquiries.edit']),grant('b',['dashboard.read','inventoryProducts.read','fake.read']),grant('c',['inventoryProducts.edit'],true)]
 assert.deepEqual(composeProfilePermissions('MANAGER',grants),allPermissions.filter(p=>['dashboard.read','enquiries.read','enquiries.edit','inventoryProducts.read'].includes(p)))
 assert.deepEqual(composeProfilePermissions('MANAGER',[]),[]);assert.deepEqual(composeProfilePermissions('STAFF',[]),[])
 assert.equal(composeProfilePermissions('ADMIN',[]),undefined)
})
test('adding an unrelated module profile cannot widen visibility or grant edit access',()=>{
 const actor={role:'MANAGER',recordRules:{'enquiries.read':'OWN','projects.read':'MANAGED_TEAMS'},permissions:composeProfilePermissions('MANAGER',[grant('crm',['enquiries.read','enquiries.edit']),grant('inventory',['inventoryProducts.read'])])}
 assert.equal(recordScope(actor,'enquiries'),'OWN');assert.equal(recordScope(actor,'projects'),'MANAGED_TEAMS');assert.equal(actor.permissions.includes('inventoryProducts.edit'),false)
})
test('each resource module automatically has bounded viewer/manager templates',()=>{
 for(const moduleKey of new Set(Object.values(accessResources).map(resource=>resource.module))){
  const templates=moduleProfileTemplates.filter(item=>item.moduleKey===moduleKey);assert.equal(templates.length,2)
  for(const template of templates)assert.equal(validProfilePermissions(moduleKey,template.permissions),true)
  assert.ok(templates.every(t=>t.permissions.includes('dashboard.read')))
 }
 assert.equal(validProfilePermissions('inventory',['inventoryProducts.read','enquiries.read']),false)
 assert.throws(()=>accessRoleSchema.parse({name:'Mismatch',moduleKey:'inventory',permissions:['enquiries.read']}))
 assert.throws(()=>roleAssignmentSchema.parse({roleIds:['a','a'],version:0,rules:{}}))
 assert.throws(()=>accessRoleSchema.parse({name:'Old mixed fields',permissions:[],salesRecordScope:'ALL'}))
})
