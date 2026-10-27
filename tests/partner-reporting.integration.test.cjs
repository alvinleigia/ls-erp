/* eslint-disable @typescript-eslint/no-require-imports */
const {test,before,after}=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto'),{Pool}=require('pg'),{PrismaClient}=require('@prisma/client'),{parse}=require('csv-parse/sync')
const {TenantPgAdapter}=require('../lib/tenant-pg-adapter.ts'),{createCrmService}=require('../modules/crm/service.ts'),{createCollaboratorService}=require('../platform/collaborators/service.ts'),{createOfficeAccessService}=require('../platform/companies/office-access.ts'),{createCompanyService}=require('../platform/companies/service.ts'),{createAccessRoleService}=require('../platform/access/service.ts'),{createRecordSharingService}=require('../platform/access/sharing-service.ts')
const {allPermissions}=require('../platform/access/catalog.ts'),{defaultRecordRules,supportedScopes}=require('../platform/access/rules.ts')
require('../lib/logger.ts').logger.info=()=>{}
const url=new URL(process.env.CRM_TEST_DATABASE_URL||'http://invalid');if(!['localhost','127.0.0.1'].includes(url.hostname)||url.pathname!='/ls_salon_crm_test')throw Error('Disposable local database only.')
const tenant='partner_reports_'+randomUUID(),foreign=tenant+'_foreign',clients=[],pools=[],identity=u=>({tenantId:u.tenantId,userId:u.id}),status=n=>e=>e.status===n
function client(tenantId,bypass=false){const u=new URL(url);if(!bypass){u.username='crm_test_runtime';u.password=''}const pool=new Pool({connectionString:u.toString(),max:4});pools.push(pool);const db=new PrismaClient({adapter:new TenantPgAdapter(pool,{tenantId,bypass})});clients.push(db);return db}
const root=client(undefined,true),db=client(tenant),other=client(foreign),crm=u=>createCrmService(db,identity(u)),directory=u=>createCollaboratorService(db,identity(u)),day=new Date().toISOString().slice(0,10),period={scope:'team',from:day,through:day}
let admin,staff,manager,p1,p2,a,b,contact,pipeline,open,won,role,office,access,leadA
const enquiry=(title,user=admin,extra={})=>crm(user).createEnquiry({title,contactId:contact.id,assignedUserId:user.id,...extra})
const deal=(title,user=admin,extra={})=>crm(user).createOpportunity({title,contactId:contact.id,assignedUserId:user.id,pipelineId:pipeline.id,stageId:open.id,amount:'100',currency:'INR',expectedCloseOn:'2030-01-01',...extra})
const choices=(user,extra={})=>crm(user).salesAttributionChoices({...period,choice:'partner',...extra})
before(async()=>{
 await root.tenant.createMany({data:[tenant,foreign].map(id=>({id,slug:id,name:id}))})
 const user=(role,extra={})=>root.user.create({data:{tenantId:tenant,role,name:role,email:randomUUID()+'@example.test',...extra}})
 admin=await user('ADMIN');staff=await user('STAFF');manager=await user('MANAGER')
 await root.tenantModule.create({data:{tenantId:tenant,key:'crm',allowed:true,enabled:true}})
 a=await directory(admin).create({name:'Agency Alpha',code:'ALPHA',supervisorUserId:manager.id});b=await directory(admin).create({name:'Agency Beta',code:'BETA',supervisorUserId:admin.id})
 p1=await user('STAFF',{collaboratorId:a.id});p2=await user('STAFF',{collaboratorId:a.id});office='office_'+tenant
 access=createOfficeAccessService(db,identity(admin));for(const u of [admin,staff,manager,p1,p2]){const p=await access.getMemberships(u.id);await access.saveMemberships(u.id,{version:p.version,officeIds:[office],companies:[],creationOfficeId:office})}
 const profiles=createAccessRoleService(db,identity(admin));role=await profiles.save({name:'Explicit reporting',permissions:allPermissions.filter(p=>['contacts','enquiries','opportunities','pipelines','reports','activities'].includes(p.split('.')[0]))});const rules=defaultRecordRules()
 for(const key of Object.keys(rules))if(supportedScopes(key.split('.')[0]).includes('ALL'))rules[key]='ALL'
 for(const u of [staff,manager,p1,p2]){const p=await profiles.assignment(u.id);await profiles.assign(u.id,{version:p.accessPolicy.version,roleIds:[role.id],rules:{...rules,...(u.id===staff.id?{'reports.read':'OWN','reports.export':'OWN','enquiries.read':'OWN','opportunities.read':'OWN'}:{})}})}
 contact=await crm(admin).createContact({name:'Shared buyer'})
 pipeline=await crm(admin).createPipeline({name:'Reporting',stages:[{name:'Open',kind:'OPEN',probability:10,color:'#123456'},{name:'Won',kind:'WON',probability:100,color:'#00aa00'},{name:'Lost',kind:'LOST',probability:0,color:'#aa0000'}]});open=pipeline.stages.find(s=>s.kind==='OPEN');won=pipeline.stages.find(s=>s.kind==='WON')
 const ordinary=await enquiry('Direct internal');leadA=await enquiry('Alpha internal handling',admin,{introducedByCollaboratorId:a.id,assignedUserId:staff.id})
 await enquiry('Alpha external handling',p1);await enquiry('Alpha second login',p2);await enquiry('Beta internal handling',admin,{introducedByCollaboratorId:b.id,assignedUserId:staff.id})
 await deal('Won Alpha',admin,{enquiryId:leadA.id,assignedUserId:staff.id,stageId:won.id});await deal('Open Alpha',p1,{amount:'200.0001'});await deal('Open Beta',admin,{introducedByCollaboratorId:b.id,amount:'50',currency:'USD'});await deal('Converted ordinary',p1,{enquiryId:ordinary.id,amount:'10'})
})
after(async()=>{await Promise.all(clients.map(c=>c.$disconnect()));await Promise.all(pools.map(p=>p.end()))})

test('internal/external ownership and recorded introduction are independent filters; company totals count canonical outcomes once',async()=>{
 const all=await crm(admin).salesOverview(period);assert.deepEqual(all.totals,{leads:5,converted:2,pipeline:3,won:1,lost:0,overdue:0,gaps:3})
 const internal=await crm(admin).salesOverview({...period,responsibleType:'internal'}),external=await crm(admin).salesOverview({...period,responsibleType:'external'})
 for(const metric of ['leads','converted','pipeline','won','lost'])assert.equal(internal.totals[metric]+external.totals[metric],all.totals[metric])
 assert.equal(internal.totals.leads,3);assert.equal(external.totals.leads,2)
 assert.equal((await crm(admin).salesOverview({...period,introduction:'partner'})).totals.leads,4)
 assert.equal((await crm(admin).salesOverview({...period,introduction:'unattributed'})).totals.leads,1)
 assert.equal((await crm(admin).salesOverview({...period,introducedByCollaboratorId:a.id,responsibleType:'internal'})).totals.leads,1)
 assert.equal((await crm(admin).salesOverview({...period,introduction:'unattributed',responsibleType:'external'})).totals.pipeline,1)
})
test('all new filters reconcile overview, breakdowns, paged drilldowns, decimal/currency values and CSV exports',async()=>{
 for(const filter of [{introducedByCollaboratorId:a.id},{introductionSupervisorId:manager.id},{responsibleType:'external'},{introduction:'unattributed'}]){
  const q={...period,...filter},summary=await crm(admin).salesOverview(q)
  for(const [view,total] of Object.entries(summary.totals)){
   const rows=await crm(admin).salesReportRecords({...q,view,pageSize:1});assert.equal(rows.total,total);const ids=[]
   for(let page=1;page<=rows.totalPages;page++)ids.push(...(await crm(admin).salesReportRecords({...q,view,page,pageSize:1})).items.map(r=>r.id))
   assert.equal(new Set(ids).size,total)
   const exported=parse(await crm(admin).exportSalesReport({...q,view,page:99,pageSize:1}),{bom:true,columns:true});assert.equal(exported.length,total)
   for(const row of exported)assert.ok(ids.includes(row.ID))
  }
 }
 for(const dimension of ['partner','introductionSupervisor','responsibleType']){
  const groups=await crm(admin).salesLeadBreakdown({...period,dimension});assert.equal(groups.items.reduce((n,r)=>n+r.leads,0),5)
  for(const group of groups.items){assert.equal((await crm(admin).salesReportRecords({...period,dimension,bucket:group.id})).total,group.leads);assert.equal((await crm(admin).salesReportRecords({...period,dimension,bucket:group.id,view:'converted'})).total,group.converted)}
 }
 const values=await crm(admin).salesValueBreakdown({...period,introducedByCollaboratorId:a.id,view:'pipeline'});assert.equal(values.items[0].amount,'200.0001');assert.equal(values.items[0].count,1)
 const rows=parse(await crm(admin).exportSalesReport({...period,view:'won',introducedByCollaboratorId:a.id}),{bom:true,columns:true});assert.equal(rows[0]['Introducing collaborator'],'Agency Alpha');assert.equal(rows[0]['Partner code'],'ALPHA');assert.equal(rows[0]['Supervisor at introduction'],'MANAGER')
})
test('report choices use one visible source population for search, counts, paging and selected identity',async()=>{
 const first=await choices(manager,{pageSize:1}),second=await choices(manager,{pageSize:1,page:2});assert.equal(first.total,2);assert.equal(new Set([...first.items,...second.items].map(r=>r.id)).size,2)
 assert.equal((await choices(manager,{q:'ALPHA'})).items[0].id,a.id);assert.equal((await choices(manager,{selectedId:b.id})).items[0].id,b.id)
 assert.equal((await choices(manager,{selectedId:'missing'})).total,0)
 const supervisors=await choices(manager,{choice:'supervisor'});assert.equal(supervisors.total,2);assert.ok(supervisors.items.every(r=>Object.keys(r).sort().join(',')==='id,name'))
 await assert.rejects(directory(manager).list({}),status(403))
 await root.user.update({where:{id:manager.id},data:{name:''}})
 assert.equal((await choices(admin,{choice:'supervisor',selectedId:manager.id})).items[0].name,'Unnamed supervisor')
 await root.user.update({where:{id:manager.id},data:{name:'MANAGER'}})
})
test('saved supervision and historical labels survive directory changes and archive without changing attribution or choices',async()=>{
 a=await directory(admin).update(a.id,{version:a.version,name:'Agency Renamed',supervisorUserId:admin.id});await enquiry('New Alpha supervision',admin,{introducedByCollaboratorId:a.id,assignedUserId:staff.id})
 a=await directory(admin).update(a.id,{version:a.version,archived:true})
 assert.equal((await crm(manager).salesOverview({...period,introductionSupervisorId:manager.id})).totals.leads,3)
 assert.equal((await crm(manager).salesOverview({...period,introductionSupervisorId:admin.id})).totals.leads,2)
 const original=await crm(manager).salesReportRecords({...period,introducedByCollaboratorId:a.id});assert.ok(original.items.some(r=>r.partnerName==='Agency Alpha'));assert.ok(original.items.some(r=>r.partnerName==='Agency Renamed'))
 assert.equal((await choices(manager,{selectedId:a.id})).items[0].name,'Agency Renamed (ALPHA)')
})
test('Restricted and outside-office sources cannot reveal partner or supervisor choices, record counts or exports',async()=>{
 const hidden=await directory(admin).create({name:'Secret agency',code:'SECRET',supervisorUserId:admin.id}),row=await enquiry('Restricted source',admin,{introducedByCollaboratorId:hidden.id})
 const sharing=createRecordSharingService(db,identity(admin)),state=await sharing.get('enquiries',row.id);await sharing.save('enquiries',row.id,{version:state.version,restricted:true,grants:[]})
 assert.equal((await choices(manager,{selectedId:hidden.id})).total,0);assert.equal((await crm(manager).salesOverview({...period,introducedByCollaboratorId:hidden.id})).totals.leads,0)
 assert.equal(parse(await crm(manager).exportSalesReport({...period,introducedByCollaboratorId:hidden.id}),{bom:true,columns:true}).length,0)
 const outside=await directory(admin).create({name:'Outside agency',code:'OUTSIDE',supervisorUserId:admin.id}),companies=createCompanyService(db,identity(admin)),company=await companies.createCompany({name:'Outside company',code:'OUTSIDE'}),branch=await companies.createOffice({companyId:company.id,name:'Outside office',code:'OUTSIDE'})
 let p=await access.getMemberships(admin.id);await access.saveMemberships(admin.id,{version:p.version,officeIds:[office,branch.id],companies:[],creationOfficeId:branch.id});await enquiry('Outside source',admin,{introducedByCollaboratorId:outside.id})
 p=await access.getMemberships(admin.id);await access.saveMemberships(admin.id,{version:p.version,officeIds:[office,branch.id],companies:[],creationOfficeId:office})
 assert.equal((await choices(manager,{selectedId:outside.id})).total,0);assert.equal((await choices(admin,{selectedId:outside.id})).total,1)
 const fAdmin=await root.user.create({data:{tenantId:foreign,role:'ADMIN',email:randomUUID()+'@example.test'}});await root.tenantModule.create({data:{tenantId:foreign,key:'crm',allowed:true,enabled:true}})
 assert.equal((await createCrmService(other,identity(fAdmin)).salesAttributionChoices({...period,choice:'partner',selectedId:a.id})).total,0)
})
test('own scope, malformed/contradictory filters, injection strings and current permission/module revocation stay bounded',async()=>{
 const own={...period,scope:'mine'};assert.equal((await crm(staff).salesOverview({...own,introducedByCollaboratorId:b.id})).totals.leads,1)
 for(const method of ['salesOverview','salesLeadBreakdown','salesReportRecords','exportSalesReport','salesAttributionChoices'])await assert.rejects(crm(staff)[method]({...period,...(method==='salesAttributionChoices'?{choice:'partner'}:{})}),status(403))
 assert.throws(()=>crm(admin).salesOverview({...period,responsibleType:'employee'}),e=>e.name==='ZodError')
 assert.throws(()=>crm(admin).salesOverview({...period,introduction:'unattributed',introducedByCollaboratorId:a.id}),e=>e.name==='ZodError')
 assert.equal((await crm(admin).salesOverview({...period,introducedByCollaboratorId:"' OR 1=1 --"})).totals.leads,0)
 await root.tenantModule.update({where:{tenantId_key:{tenantId:tenant,key:'crm'}},data:{enabled:false}})
 try{await assert.rejects(choices(manager),status(403))}finally{await root.tenantModule.update({where:{tenantId_key:{tenantId:tenant,key:'crm'}},data:{enabled:true}})}
 const profiles=createAccessRoleService(db,identity(admin)),p=await profiles.assignment(manager.id);await profiles.assign(manager.id,{version:p.accessPolicy.version,roleIds:[],rules:p.accessPolicy.rules});await assert.rejects(choices(manager),status(403))
})
