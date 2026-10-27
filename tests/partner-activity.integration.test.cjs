/* eslint-disable @typescript-eslint/no-require-imports */
const {test,before,after}=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto'),{Pool}=require('pg'),{PrismaClient}=require('@prisma/client'),{parse}=require('csv-parse/sync')
const {Prisma}=require('@prisma/client'),{runWithDatabaseActor}=require('../lib/database-actor.ts'),{workScope,workScopeSql}=require('../modules/crm/work-scope.ts'),{findAccessUser,accessContext}=require('../platform/access/server.ts')
const {TenantPgAdapter}=require('../lib/tenant-pg-adapter.ts'),{createCrmService}=require('../modules/crm/service.ts'),{createCollaboratorService}=require('../platform/collaborators/service.ts'),{createOfficeAccessService}=require('../platform/companies/office-access.ts'),{createAccessRoleService}=require('../platform/access/service.ts'),{createRecordSharingService}=require('../platform/access/sharing-service.ts')
const {allPermissions}=require('../platform/access/catalog.ts'),{defaultRecordRules,supportedScopes}=require('../platform/access/rules.ts')
require('../lib/logger.ts').logger.info=()=>{}
const url=new URL(process.env.CRM_TEST_DATABASE_URL||'http://invalid');if(!['localhost','127.0.0.1'].includes(url.hostname)||url.pathname!='/ls_salon_crm_test')throw Error('Disposable local database only.')
const tenant='partner_activity_'+randomUUID(),foreign=tenant+'_foreign',clients=[],pools=[],identity=u=>({tenantId:u.tenantId,userId:u.id}),status=n=>e=>e.status===n
function client(tenantId,bypass=false){const u=new URL(url);if(!bypass){u.username='crm_test_runtime';u.password=''}const pool=new Pool({connectionString:u.toString(),max:4});pools.push(pool);const db=new PrismaClient({adapter:new TenantPgAdapter(pool,{tenantId,bypass})});clients.push(db);return db}
const root=client(undefined,true),db=client(tenant),other=client(foreign),crm=u=>createCrmService(db,identity(u)),directory=u=>createCollaboratorService(db,identity(u)),day=new Date().toISOString().slice(0,10),period={scope:'team',from:day,through:day}
let admin,staff,manager,p1,p2,a,b,contact,pipeline,open,role,office,access,leadA,team
const work=(title,user,link={},type='TASK')=>crm(admin).createWork({title,type,contactId:contact.id,assignedUserId:user.id,dueOn:'2020-01-01',...(type==='CALL'?{callDirection:'OUTBOUND'}:{}),...link})
const finish=(row,outcome='DONE')=>crm(admin).completeWork(row.id,{version:row.version,summary:'Synthetic activity completion',outcome,occurredAt:new Date().toISOString()})
const enquiry=(title,user=admin,extra={})=>crm(user).createEnquiry({title,contactId:contact.id,assignedUserId:user.id,...extra})
const deal=(title,user=admin,extra={})=>crm(user).createOpportunity({title,contactId:contact.id,assignedUserId:user.id,pipelineId:pipeline.id,stageId:open.id,amount:'100',currency:'INR',expectedCloseOn:'2030-01-01',...extra})
const choices=(user,extra={})=>crm(user).activityAttributionChoices({...period,choice:'partner',...extra})
before(async()=>{
 await root.tenant.createMany({data:[tenant,foreign].map(id=>({id,slug:id,name:id}))})
 const user=(role,extra={})=>root.user.create({data:{tenantId:tenant,role,name:role,email:randomUUID()+'@example.test',...extra}})
 admin=await user('ADMIN');staff=await user('STAFF');manager=await user('MANAGER')
 await root.tenantModule.create({data:{tenantId:tenant,key:'crm',allowed:true,enabled:true}})
 a=await directory(admin).create({name:'Agency Alpha',code:'ALPHA',supervisorUserId:manager.id});b=await directory(admin).create({name:'Agency Beta',code:'BETA',supervisorUserId:admin.id})
 p1=await user('STAFF',{collaboratorId:a.id});p2=await user('STAFF',{collaboratorId:a.id});office='office_'+tenant
 access=createOfficeAccessService(db,identity(admin));for(const u of [admin,staff,manager,p1,p2]){const p=await access.getMemberships(u.id);await access.saveMemberships(u.id,{version:p.version,officeIds:[office],companies:[],creationOfficeId:office})}
 const profiles=createAccessRoleService(db,identity(admin));role=await profiles.save({name:'Explicit reporting',permissions:allPermissions.filter(p=>['contacts','enquiries','opportunities','pipelines','reports','activities','activityTypes','teams','teamMembers'].includes(p.split('.')[0]))});const rules=defaultRecordRules()
 for(const key of Object.keys(rules))if(supportedScopes(key.split('.')[0]).includes('ALL'))rules[key]='ALL'
 for(const u of [staff,manager,p1,p2]){const p=await profiles.assignment(u.id);await profiles.assign(u.id,{version:p.accessPolicy.version,roleIds:[role.id],rules:{...rules,...(u.id===staff.id?{'reports.read':'OWN','reports.export':'OWN','enquiries.read':'OWN','opportunities.read':'OWN'}:{})}})}
 contact=await crm(admin).createContact({name:'Shared buyer'})
 pipeline=await crm(admin).createPipeline({name:'Reporting',stages:[{name:'Open',kind:'OPEN',probability:10,color:'#123456'},{name:'Won',kind:'WON',probability:100,color:'#00aa00'},{name:'Lost',kind:'LOST',probability:0,color:'#aa0000'}]});open=pipeline.stages.find(s=>s.kind==='OPEN')
 const ordinary=await enquiry('Unattributed source');leadA=await enquiry('Alpha source',admin,{introducedByCollaboratorId:a.id});const leadB=await enquiry('Beta source',admin,{introducedByCollaboratorId:b.id,assignedUserId:staff.id})
 await work('Internal Alpha open',staff,{enquiryId:leadA.id});await work('External Alpha due',p1,{enquiryId:leadA.id,dueOn:day})
 await finish(await work('External Alpha call',p2,{enquiryId:leadA.id},'CALL'),'CONNECTED');await finish(await work('Internal Beta call',staff,{enquiryId:leadB.id},'CALL'),'NO_ANSWER')
 await work('Contact-only open',staff);await finish(await work('Unattributed complete',staff,{enquiryId:ordinary.id}))
 const cancelled=await work('Cancelled Beta',p1,{enquiryId:leadB.id});await crm(admin).cancelWork(cancelled.id,{version:cancelled.version,reason:'Synthetic cancelled task'})
 await deal('Internal Alpha gap',admin,{introducedByCollaboratorId:a.id,assignedUserId:staff.id});await deal('External Beta gap',admin,{introducedByCollaboratorId:b.id,assignedUserId:p1.id})

})
after(async()=>{await Promise.all(clients.map(c=>c.$disconnect()));await Promise.all(pools.map(p=>p.end()))})

test('activity identity and introduction partition independently, with completions credited to assignee rather than operator',async()=>{
 const total=await crm(admin).activityOverview(period);assert.deepEqual(total.totals,{open:3,overdue:2,dueToday:1,completed:3,withoutActivity:2})
 const internal=await crm(admin).activityOverview({...period,responsibleType:'internal'}),external=await crm(admin).activityOverview({...period,responsibleType:'external'})
 for(const key of Object.keys(total.totals))assert.equal(internal.totals[key]+external.totals[key],total.totals[key])
 assert.equal(external.totals.completed,1);assert.equal(internal.totals.completed,2)
 assert.deepEqual((await crm(admin).activityOverview({...period,introducedByCollaboratorId:a.id})).totals,{open:2,overdue:1,dueToday:1,completed:1,withoutActivity:1})
 assert.deepEqual((await crm(admin).activityOverview({...period,introduction:'unattributed'})).totals,{open:1,overdue:1,dueToday:0,completed:1,withoutActivity:0})
 const people=await crm(admin).staffActivityReport({...period,pageSize:100});assert.equal(people.items.find(u=>u.id===admin.id).completed,0);assert.equal(people.items.find(u=>u.id===p2.id).completed,1);assert.equal(people.items.find(u=>u.id===p2.id).userType,'external')
})
test('summary, user pagination, type/outcome breakdowns, gaps, work links and CSVs reconcile through every attribution filter',async()=>{
 for(const filter of [{},{responsibleType:'external'},{introducedByCollaboratorId:a.id},{introductionSupervisorId:manager.id},{introduction:'unattributed'}]){
  const q={...period,...filter},summary=await crm(admin).activityOverview(q),people=await crm(admin).staffActivityReport({...q,pageSize:1});let counted=0
  for(let page=1;page<=people.totalPages;page++)counted+=(await crm(admin).staffActivityReport({...q,pageSize:1,page})).items.reduce((n,r)=>n+r.completed,0)
  assert.equal(counted,summary.totals.completed);assert.equal(summary.byType.reduce((n,r)=>n+r.open,0),summary.totals.open)
  assert.equal((await crm(admin).opportunitiesWithoutActivity({...q,pageSize:100})).total,summary.totals.withoutActivity)
  for(const [state,count]of[['open',summary.totals.open],['completed',summary.totals.completed]]){
   const input={...filter,scope:'visible',state,...(state==='completed'?{completedFrom:day,completedThrough:day}:{})},rows=await crm(admin).listWork({...input,pageSize:1}),exported=parse(await crm(admin).exportWork({...input,page:99,pageSize:1}),{bom:true,columns:true})
   assert.equal(rows.total,count);assert.equal(exported.length,count)
   const ids=[];for(let page=1;page<=rows.totalPages;page++)ids.push(...(await crm(admin).listWork({...input,pageSize:1,page})).items.map(r=>r.id));assert.equal(new Set(ids).size,count)
   for(const row of exported)assert.ok(ids.includes(row.ID))
  }
 }
 assert.deepEqual((await crm(admin).activityOverview({...period,introducedByCollaboratorId:a.id,type:'CALL'})).callOutcomes,[{outcome:'CONNECTED',count:1}])
})
test('activity choices use actual work and gap visibility, retain archived snapshots, and share search/page/count/selected-label scope',async()=>{
 const first=await choices(manager,{pageSize:1}),second=await choices(manager,{pageSize:1,page:2});assert.equal(first.total,2);assert.equal(new Set([...first.items,...second.items].map(r=>r.id)).size,2)
 assert.equal((await choices(manager,{q:'ALPHA',selectedId:a.id})).items[0].id,a.id)
 await enquiry('No work or gap for unused partner',admin,{introducedByCollaboratorId:(await directory(admin).create({name:'Unused agency',code:'UNUSED',supervisorUserId:admin.id})).id})
 assert.equal((await choices(manager,{q:'UNUSED'})).total,0)
 a=await directory(admin).update(a.id,{version:a.version,archived:true});assert.equal((await choices(manager,{selectedId:a.id})).items[0].name,'Agency Alpha (ALPHA)')
 const supervisor=await choices(manager,{choice:'supervisor',selectedId:manager.id});assert.equal(supervisor.items[0].id,manager.id)
 a=await directory(admin).update(a.id,{version:a.version,archived:false});for(const u of [p1,p2])await root.user.update({where:{id:u.id},data:{status:'ACTIVE'}})
})
test('a readable activity with a source outside Read cannot become a partner/supervisor inference path',async()=>{
 const secret=await directory(admin).create({name:'Hidden origin',code:'HIDDEN',supervisorUserId:admin.id}),source=await enquiry('Hidden source owned by admin',admin,{introducedByCollaboratorId:secret.id})
 await work('Visible child with hidden parent',staff,{enquiryId:source.id})
 assert.ok((await crm(staff).listWork({scope:'mine'})).items.some(r=>r.title==='Visible child with hidden parent'&&r.parent===null))
 assert.equal((await crm(staff).listWork({scope:'mine',introducedByCollaboratorId:secret.id})).total,0)
 assert.equal((await crm(staff).activityOverview({...period,scope:'mine',introducedByCollaboratorId:secret.id})).totals.open,0)
 assert.equal((await choices(staff,{scope:'mine',selectedId:secret.id})).total,0)
 const sharing=createRecordSharingService(db,identity(admin)),state=await sharing.get('enquiries',source.id);await sharing.save('enquiries',source.id,{version:state.version,restricted:true,grants:[]})
 assert.equal((await choices(manager,{selectedId:secret.id})).total,0)
})
test('source Read and export action/scopes remain independent and are enforced on fresh requests',async()=>{
 const profiles=createAccessRoleService(db,identity(admin)),limited=await profiles.save({name:'Activity-only reader',permissions:['activities.read','activities.export']}),assignment=await profiles.assignment(manager.id)
 const rules={...assignment.accessPolicy.rules,'activities.export':'OWN'}
 await profiles.assign(manager.id,{version:assignment.accessPolicy.version,roleIds:[limited.id],rules})
 assert.ok((await crm(manager).listWork({scope:'visible',responsibleType:'internal'})).total>0)
 await assert.rejects(crm(manager).listWork({scope:'visible',introduction:'unattributed'}),status(403));await assert.rejects(crm(manager).exportWork({introducedByCollaboratorId:a.id}),status(403))
 assert.equal(parse(await crm(manager).exportWork({scope:'visible'}),{bom:true,columns:true}).length,0)
 const readOnly=await profiles.save({name:'Activity without export',permissions:['activities.read']}),current=await profiles.assignment(manager.id)
 await profiles.assign(manager.id,{version:current.accessPolicy.version,roleIds:[readOnly.id],rules:assignment.accessPolicy.rules})
 assert.ok((await crm(manager).listWork({scope:'visible'})).total>0);await assert.rejects(crm(manager).exportWork({scope:'visible'}),status(403))
 const saved=await profiles.assignment(manager.id);await profiles.assign(manager.id,{version:saved.accessPolicy.version,roleIds:[role.id],rules:assignment.accessPolicy.rules})
})
test('ORM and SQL activity scopes agree for Own, Related, Managed teams, shared records and None',async()=>{
 const {createBusinessTeamService}=require('../platform/teams/business-service.ts'),teams=createBusinessTeamService(db,identity(admin));team=await teams.saveTeam({name:'Activity parity team'})
 const state=await teams.getTeam(team.id);await teams.changeTeamMember(team.id,{version:state.version,userId:manager.id,isManager:true})
 await root.crmEnquiry.update({where:{id:leadA.id},data:{salesTeamId:team.id}})
 const profiles=createAccessRoleService(db,identity(admin));let assignment=await profiles.assignment(manager.id)
 const sharing=createRecordSharingService(db,identity(admin)),unrelated=await work('Explicitly shared activity',staff),policy=await sharing.get('activities',unrelated.id);await sharing.save('activities',unrelated.id,{version:policy.version,restricted:false,grants:[{kind:'USER',id:manager.id,level:'READ'}]})
 for(const scope of ['OWN','RELATED','MANAGED_TEAMS','NONE','ALL']){
  await profiles.assign(manager.id,{version:assignment.accessPolicy.version,roleIds:[role.id],rules:{...assignment.accessPolicy.rules,'activities.read':scope}});assignment=await profiles.assignment(manager.id)
  await runWithDatabaseActor(manager.id,async()=>await db.$transaction(async tx=>{
   const user=await findAccessUser(tx,tenant,manager.id),actor={...identity(manager),...accessContext(user)}
   await tx.$executeRaw`SELECT set_config('app.actor_id',${manager.id},true)`
   const orm=await tx.crmTask.findMany({where:workScope(actor),select:{id:true}}),sql=await tx.$queryRaw(Prisma.sql`SELECT t.id FROM "CrmTask" t WHERE ${workScopeSql(actor,'t')}`)
   assert.deepEqual(orm.map(r=>r.id).sort(),sql.map(r=>r.id).sort(),scope)
  }))
 }
})
test('malformed filters, cross-tenant selected IDs and disabled modules cannot widen reporting or exports',async()=>{
 assert.throws(()=>crm(admin).activityOverview({...period,introduction:'unattributed',introducedByCollaboratorId:a.id}),e=>e.name==='ZodError')
 assert.equal((await choices(admin,{selectedId:"' OR 1=1 --"})).total,0)
 const fAdmin=await root.user.create({data:{tenantId:foreign,role:'ADMIN',email:randomUUID()+'@example.test'}});await root.tenantModule.create({data:{tenantId:foreign,key:'crm',allowed:true,enabled:true}})
 assert.equal((await createCrmService(other,identity(fAdmin)).activityAttributionChoices({...period,choice:'partner',selectedId:a.id})).total,0)
 await root.tenantModule.update({where:{tenantId_key:{tenantId:tenant,key:'crm'}},data:{enabled:false}})
 try{await assert.rejects(choices(admin),status(403));await assert.rejects(crm(admin).exportWork({}),status(403))}finally{await root.tenantModule.update({where:{tenantId_key:{tenantId:tenant,key:'crm'}},data:{enabled:true}})}
})

test('activity CSV escapes formula cells and rejects oversized selections before returning any rows',async()=>{
 await work('=Synthetic formula cell',staff)
 const exported=parse(await crm(admin).exportWork({scope:'visible',q:'=Synthetic'}),{bom:true,columns:true});assert.equal(exported[0].Activity,"'=Synthetic formula cell")
 await root.crmTask.createMany({data:Array.from({length:2001},(_,i)=>({tenantId:tenant,officeId:office,contactId:contact.id,assignedUserId:admin.id,createdByUserId:admin.id,title:'Bulk activity CSV '+i,type:'TASK',dueOn:new Date('2020-01-01')}))})
 assert.equal((await crm(admin).listWork({scope:'visible',q:'Bulk activity CSV',pageSize:1})).total,2001)
 await assert.rejects(crm(admin).exportWork({scope:'visible',q:'Bulk activity CSV',pageSize:1}),status(400))
})
