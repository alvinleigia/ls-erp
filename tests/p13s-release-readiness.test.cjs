/* eslint-disable @typescript-eslint/no-require-imports */
const {test}=require('node:test'),assert=require('node:assert/strict')
const {manifest,verifySource,historyProblems,summarizeHistory,proposePartnerAccess,partnerPermissions}=require('../scripts/p13s-release-readiness.cjs')
const {proposeCentralCollectionsAccess,centralCollectionsScopes}=require('../scripts/p13s-release-readiness.cjs')
const rows=()=>manifest.migrations.map(m=>({name:m.name,checksum:m.sha256Lf,finished:true,rolledBack:false}))
test('P13S source pins seven migrations, all earlier released SQL and the reviewed schema',()=>{
 verifySource()
 for(const edit of [m=>m.migrations.reverse(),m=>m.migrations.pop(),m=>{m.migrations[149].sha256Lf='changed'},m=>{m.schemaSha256Lf='changed'},m=>{m.baseline.inventorySha256='changed'},m=>{m.baseline.commit='changed'}]){const m=structuredClone(manifest);edit(m);assert.throws(()=>verifySource(m))}
})
test('production must remain a verified 150-migration prefix until controlled cutover',()=>{
 const before=rows().slice(0,150);assert.deepEqual(summarizeHistory(before),{historyRows:150,appliedMigrations:150,pendingMigrations:7,rolledBackAttempts:0});assert.equal(historyProblems(before).length,7);assert.deepEqual(historyProblems(before,false),[])
 assert.equal(summarizeHistory(rows()).pendingMigrations,0)
 for(const r of [before.slice(1),[...before,before[0]],[...before,{...rows()[150],finished:false}],[...before,{...rows()[150],checksum:'changed'}],[...before,rows()[151]]])assert.throws(()=>summarizeHistory(r))
})
test('historical rolled-back attempts remain recorded and cannot disguise changed SQL',()=>{
 const r=[...rows().slice(0,150),{...rows()[30],finished:false,rolledBack:true}];assert.equal(summarizeHistory(r).rolledBackAttempts,1);r[150].checksum='changed';assert.throws(()=>summarizeHistory(r))
})
const input=()=>({profile:{id:'profile',version:3,name:'Booking & Collections',moduleKey:'all',archived:false,permissions:['opportunities.read','opportunities.create','opportunities.edit','orderDocuments.read','orderPayments.create']},policy:{version:4,rules:{'opportunities.read':'OWN','opportunities.edit':'OWN','orderDocuments.read':'OWN','orderPayments.create':'OWN','contacts.read':'RELATED'}},roleIds:['profile','unrelated']})
test('CP proposal adds four capabilities and bounded lookup/link scopes without changing any sales authority',()=>{
 const i=input(),before=structuredClone(i),p=proposePartnerAccess(i.profile,i.policy,i.roleIds);assert.deepEqual(i,before);assert.deepEqual(p.addedPermissions,partnerPermissions);assert.deepEqual(p.changedRules,partnerPermissions)
 assert.deepEqual(p.role.body.permissions.slice(0,i.profile.permissions.length),i.profile.permissions);for(const [key,value]of Object.entries(i.policy.rules))assert.equal(p.assignment.body.rules[key],value)
 assert.deepEqual(p.assignment.body.roleIds,i.roleIds);assert.equal(p.role.body.version,3);assert.equal(p.assignment.body.version,4);assert.equal(p.role.body.name,i.profile.name);assert.equal(p.kycGrantsAdded,false);assert.equal(p.applied,false)
})
test('already configured partner permissions produce an idempotent no-op proposal',()=>{
 const i=input(),a=proposePartnerAccess(i.profile,i.policy,i.roleIds),b=proposePartnerAccess({...i.profile,permissions:a.role.body.permissions},{...i.policy,rules:a.assignment.body.rules},i.roleIds)
 assert.equal(b.roleNeedsUpdate,false);assert.equal(b.policyNeedsUpdate,false);assert.deepEqual(b.addedPermissions,[]);assert.deepEqual(b.changedRules,[])
})
test('the proposal refuses archived/module-limited profiles, unassigned profiles and missing parent actions',()=>{
 for(const patch of [{archived:true},{moduleKey:'crm'},{version:0},{permissions:['opportunities.read']}]){const i=input();assert.throws(()=>proposePartnerAccess({...i.profile,...patch},i.policy,i.roleIds))}
 const i=input();assert.throws(()=>proposePartnerAccess(i.profile,i.policy,[]));assert.throws(()=>proposePartnerAccess(i.profile,{...i.policy,version:0},i.roleIds))
})
test('central accounts scope covers existing collection actions without granting new capabilities or administrative access',()=>{
 const i=input();i.profile.permissions.push('contacts.read','contacts.archive','projects.read','orderPayments.cancel');i.policy.rules['contacts.archive']='OWN';i.policy.rules['orderPayments.cancel']='OWN';i.policy.rules['projects.read']='ASSIGNED';const before=structuredClone(i),p=proposeCentralCollectionsAccess(i.profile,i.policy,i.roleIds)
 assert.deepEqual(i,before);assert.equal(p.assignment.body.rules['contacts.read'],'ALL');assert.equal(p.assignment.body.rules['projects.read'],'ALL');assert.equal(p.assignment.body.rules['orderDocuments.read'],'ALL');assert.equal(p.assignment.body.rules['contacts.archive'],'OWN');assert.equal(p.assignment.body.rules['orderPayments.cancel'],'OWN')
 assert.deepEqual(p.addedPermissions,partnerPermissions);assert.deepEqual(p.role.body.permissions,[...i.profile.permissions,...partnerPermissions]);assert.equal(p.preservesOfficeMemberships,true);assert.equal(p.preservesRestrictedVisibility,true);assert.equal(p.scopeMode,'ALL_ACCESSIBLE_SALES')
 assert.equal(p.changedRules.every(k=>partnerPermissions.includes(k)||centralCollectionsScopes.includes(k)),true)
 const again=proposeCentralCollectionsAccess({...i.profile,permissions:p.role.body.permissions},{...i.policy,rules:p.assignment.body.rules},i.roleIds);assert.equal(again.roleNeedsUpdate,false);assert.equal(again.policyNeedsUpdate,false)
})
