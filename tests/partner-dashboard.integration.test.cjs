/* eslint-disable @typescript-eslint/no-require-imports */
const {test,before,after}=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto'),{Pool}=require('pg'),{PrismaClient}=require('@prisma/client')
const {TenantPgAdapter}=require('../lib/tenant-pg-adapter.ts'),{createApplicationCrmService}=require('../application/crm/service.ts'),{createDashboardSalesService}=require('../application/dashboard/sales-service.ts'),{emptyQuotationContent}=require('../modules/sales-documents/quotation-validation.ts')
const {createCollaboratorService}=require('../platform/collaborators/service.ts'),{createOfficeAccessService}=require('../platform/companies/office-access.ts'),{createAccessRoleService}=require('../platform/access/service.ts'),{createRecordSharingService}=require('../platform/access/sharing-service.ts'),{createRealEstateService}=require('../modules/real-estate/service.ts')
const {allPermissions}=require('../platform/access/catalog.ts'),{defaultRecordRules,supportedScopes}=require('../platform/access/rules.ts')
require('../lib/logger.ts').logger.info=()=>{}
const url=new URL(process.env.CRM_TEST_DATABASE_URL||'http://invalid');if(!['localhost','127.0.0.1'].includes(url.hostname)||url.pathname!='/ls_salon_crm_test')throw Error('Disposable localhost database only.')
const tenant='partner_dashboard_'+randomUUID(),foreign=tenant+'_foreign',clients=[],pools=[],identity=u=>({tenantId:u.tenantId,userId:u.id}),status=n=>e=>e.status===n
function client(tenantId,bypass=false){const u=new URL(url);if(!bypass){u.username='crm_test_runtime';u.password=''}const pool=new Pool({connectionString:u.toString(),max:4});pools.push(pool);const db=new PrismaClient({adapter:new TenantPgAdapter(pool,{tenantId,bypass})});clients.push(db);return db}
const root=client(undefined,true),db=client(tenant),other=client(foreign),crm=u=>createApplicationCrmService(db,identity(u)),directory=u=>createCollaboratorService(db,identity(u)),dashboard=u=>createDashboardSalesService(db,identity(u))
const day=new Date().toISOString().slice(0,10),selection={range:'custom',startDate:day,endDate:day}
const choices=(u,extra={})=>dashboard(u).choices({...selection,choice:'partner',...extra}),records=(u,kind,extra={})=>dashboard(u).records({...selection,kind,...extra})
let admin,manager,staff,partner,a,b,contact,pipeline,stage,won,role,rules,lead,dealA,dealB,quoteA,project
const deal=(title,user,intro,extra={})=>crm(admin).createOpportunity({title,contactId:contact.id,assignedUserId:user.id,pipelineId:pipeline.id,stageId:stage.id,amount:'100.25',currency:'INR',expectedCloseOn:'2030-01-01',...(intro?{introducedByCollaboratorId:intro}:{}),...extra})
const content=(title,dates=true)=>({...structuredClone(emptyQuotationContent),title,supplierName:'Shared services',currency:'INR',bookingDate:dates?day:'',lines:[{description:'Services',quantity:'1',unit:'service',rate:'100.25'}],instalments:[{label:'Start',percent:'50',days:0,note:''},{label:'Balance',percent:'50',days:10,note:''}]})
before(async()=>{
 await root.tenant.createMany({data:[tenant,foreign].map(id=>({id,slug:id,name:id}))});await root.appSetting.create({data:{tenantId:tenant,timeZone:'UTC'}})
 const user=(role,extra={})=>root.user.create({data:{tenantId:tenant,role,name:role,email:randomUUID()+'@example.test',...extra}})
 admin=await user('ADMIN');manager=await user('MANAGER');staff=await user('STAFF')
 await root.tenantModule.createMany({data:['crm','salesDocuments','paymentPlans'].map(key=>({tenantId:tenant,key,allowed:true,enabled:true}))})
 a=await directory(admin).create({name:'Dashboard Alpha',code:'DASH_A',supervisorUserId:manager.id});b=await directory(admin).create({name:'Dashboard Beta',code:'DASH_B',supervisorUserId:admin.id});partner=await user('STAFF',{collaboratorId:a.id})
 const access=createOfficeAccessService(db,identity(admin));for(const u of [admin,manager,staff,partner]){const p=await access.getMemberships(u.id);await access.saveMemberships(u.id,{version:p.version,officeIds:['office_'+tenant],companies:[],creationOfficeId:'office_'+tenant})}
 const profiles=createAccessRoleService(db,identity(admin));role=await profiles.save({name:'Dashboard reports',permissions:allPermissions.filter(p=>['dashboard','contacts','enquiries','opportunities','activities','activityTypes','reports','pipelines','quotations','projects'].includes(p.split('.')[0]))});rules=defaultRecordRules();for(const key of Object.keys(rules))if(supportedScopes(key.split('.')[0]).includes('ALL'))rules[key]='ALL'
 const assignment=await profiles.assignment(manager.id);await profiles.assign(manager.id,{version:assignment.accessPolicy.version,roleIds:[role.id],rules})
 contact=await crm(admin).createContact({name:'Generic dashboard customer'});pipeline=await crm(admin).createPipeline({name:'Generic sales',stages:[{name:'Open',kind:'OPEN',probability:10,color:'#123456'},{name:'Won',kind:'WON',probability:100,color:'#00aa00'},{name:'Lost',kind:'LOST',probability:0,color:'#aa0000'}]});stage=pipeline.stages[0];won=pipeline.stages.find(s=>s.kind==='WON')
 lead=await crm(admin).createEnquiry({title:'Alpha enquiry',contactId:contact.id,assignedUserId:staff.id,introducedByCollaboratorId:a.id});await crm(admin).createEnquiry({title:'Ordinary enquiry',contactId:contact.id,assignedUserId:partner.id})
 dealA=await deal('Internal Alpha sale',staff,null,{enquiryId:lead.id});dealB=await deal('External Beta sale',partner,b.id);await deal('Won Alpha',staff,a.id,{stageId:won.id});await deal('No recorded partner',partner,null)
 quoteA=await crm(admin).saveQuotation(dealA.id,{content:content('Alpha quote')});await crm(admin).saveQuotation(dealB.id,{content:content('Beta undated',false)})
 // A source contributes only via an all-time plan, outside period/open/closed CRM sets.
 const oldDeal=await deal('Old plan-only source',staff,b.id,{stageId:won.id}),old=await crm(admin).saveQuotation(oldDeal.id,{content:content('Old planned quote')})
 await root.crmQuotation.update({where:{tenantId_id:{tenantId:tenant,id:old.id}},data:{createdAt:new Date('2020-01-01')}});await root.crmOpportunity.update({where:{id:oldDeal.id},data:{closedAt:new Date('2020-01-01')}})
 const task=(title,user,link={})=>crm(admin).createWork({title,type:'CALL',callDirection:'OUTBOUND',contactId:contact.id,assignedUserId:user.id,dueOn:'2020-01-01',...link})
 await task('Internal Alpha follow-up',staff,{opportunityId:dealA.id});await task('External Beta follow-up',partner,{opportunityId:dealB.id});await task('Contact-only follow-up',staff)
 const done=await task('Completed external Alpha',partner,{opportunityId:dealA.id});await crm(admin).completeWork(done.id,{version:done.version,outcome:'CONNECTED',summary:'Synthetic completion by admin',occurredAt:new Date().toISOString()})
})
after(async()=>{await Promise.all(clients.map(c=>c.$disconnect()));await Promise.all(pools.map(p=>p.end()))})
test('dashboard identity/origin filters independently partition counts and retain actual assignee completion credit',async()=>{
 const all=(await dashboard(manager).summary(selection)).data;assert.equal(all.enquiries.total,2);assert.equal(all.opportunities.open,3);assert.equal(all.activities.completed,1);assert.equal(all.quotations.total,2);assert.equal(all.paymentPlans.documents,3);assert.equal(all.paymentPlans.upcomingCount,4);assert.equal(all.paymentPlans.undated,2)
 for(const [x,y] of [[{responsibleType:'internal'},{responsibleType:'external'}],[{introduction:'partner'},{introduction:'unattributed'}]]){
  const first=(await dashboard(manager).summary({...selection,...x})).data,second=(await dashboard(manager).summary({...selection,...y})).data
  for(const [family,key] of [['enquiries','total'],['opportunities','open'],['opportunities','won'],['activities','completed'],['activities','overdue'],['quotations','total'],['paymentPlans','documents'],['paymentPlans','upcomingCount'],['paymentPlans','undated']])assert.equal(first[family][key]+second[family][key],all[family][key],family+'.'+key)
 }
 assert.equal((await dashboard(manager).summary({...selection,responsibleType:'external',introducedByCollaboratorId:a.id})).data.activities.completed,1)
 assert.equal((await dashboard(manager).summary({...selection,responsibleType:'internal',introducedByCollaboratorId:a.id})).data.activities.completed,0)
})
test('every metric reconciles with all paged drill-downs and its canonical values',async()=>{
 const pairs=[['enquiries','enquiries','total'],['converted','enquiries','converted'],['pipeline','opportunities','open'],['won','opportunities','won'],['lost','opportunities','lost'],['overdueActivities','activities','overdue'],['completedActivities','activities','completed'],['completedCalls','activities','calls'],['quotations','quotations','total'],['planDocuments','paymentPlans','documents'],['upcomingInstalments','paymentPlans','upcomingCount'],['undatedInstalments','paymentPlans','undated']]
 for(const filter of [{},{responsibleType:'external'},{introducedByCollaboratorId:a.id},{introduction:'unattributed'}]){
  const overview=await dashboard(manager).summary({...selection,...filter})
  for(const [kind,family,key] of pairs){const first=await records(manager,kind,{...filter,pageSize:1}),rows=[];for(let page=1;page<=first.totalPages;page++)rows.push(...(await records(manager,kind,{...filter,pageSize:1,page})).items);assert.equal(first.total,overview.data[family][key],kind);assert.equal(rows.length,first.total);assert.equal(new Set(rows.map(r=>r.id)).size,first.total);assert.ok(rows.every(r=>r.href.startsWith('/crm/')))}
  const link=new URL(overview.metadata.links.completedActivities,'http://local');assert.equal(link.searchParams.get('range'),'custom');assert.equal(link.searchParams.get('startDate'),day);assert.equal(link.searchParams.get('responsibleType'),filter.responsibleType||null)
 }
})
test('choices include plan-only historical sources, share selected/search/page scope, and exclude unrelated directory entries',async()=>{
 const unused=await directory(admin).create({name:'Unused dashboard directory',code:'UNUSED',supervisorUserId:admin.id});assert.equal((await choices(manager,{selectedId:unused.id})).total,0)
 assert.equal((await choices(manager,{pageSize:1})).total,2);assert.equal((await choices(manager,{pageSize:1,page:2})).items.length,1)
 assert.equal((await choices(manager,{selectedId:a.id,q:'Beta'})).total,0);assert.equal((await choices(manager,{selectedId:a.id,q:'Alpha'})).total,1)
 assert.equal((await choices(manager,{choice:'supervisor',selectedId:manager.id})).total,1)
 // Removing period/open CRM and period quotes still retains the latest all-time plan source.
 const oldOnly=await dashboard(manager).summary({range:'custom',startDate:'2020-01-02',endDate:'2020-01-02',introducedByCollaboratorId:b.id});assert.equal(oldOnly.data.paymentPlans.documents,2)
 assert.equal((await choices(manager,{startDate:'2020-01-02',endDate:'2020-01-02',selectedId:b.id})).total,1)
})
test('current quotation versions never multiply planned amounts, undated rows or document counts',async()=>{
 const before=(await dashboard(manager).summary(selection)).data.paymentPlans
 await crm(admin).saveQuotation(dealA.id,{version:quoteA.version,content:{...content('Alpha quote'),terms:'Revision preserves plan'}},quoteA.id)
 const after=(await dashboard(manager).summary(selection)).data.paymentPlans;assert.deepEqual(after,before)
 const rows=await records(manager,'planDocuments');assert.equal(rows.total,3);assert.ok(rows.items.find(r=>r.recordId===quoteA.id).detail.includes('2'))
})
test('financial Read remains independent; missing source Read omits filtered widgets and rejects private drill-downs',async()=>{
 const profiles=createAccessRoleService(db,identity(admin)),limited=await profiles.save({name:'Only dashboard and documents',permissions:['dashboard.read','quotations.read']}),assignment=await profiles.assignment(manager.id)
 await profiles.assign(manager.id,{version:assignment.accessPolicy.version,roleIds:[limited.id],rules})
 let value=await dashboard(manager).summary(selection);assert.equal(value.data.enquiries,null);assert.equal(value.data.quotations.total,2);assert.equal(value.metadata.canFilterOrigin,false)
 const quotes=await records(manager,'quotations');assert.ok(quotes.items.every(r=>r.owner===null));await assert.rejects(choices(manager),status(403))
 value=await dashboard(manager).summary({...selection,introducedByCollaboratorId:a.id});assert.equal(value.data.quotations,null);assert.equal(value.data.paymentPlans,null);assert.equal(value.metadata.omitted.length,1);await assert.rejects(records(manager,'quotations',{introducedByCollaboratorId:a.id}),status(403))
 const saved=await profiles.assignment(manager.id);await profiles.assign(manager.id,{version:saved.accessPolicy.version,roleIds:[role.id],rules})
})
test('Restricted sources, Own rules and office removal cap all dashboard paths without creating attribution access',async()=>{
 const sharing=createRecordSharingService(db,identity(admin)),hidden=await sharing.get('opportunities',dealB.id);await sharing.save('opportunities',dealB.id,{version:hidden.version,restricted:true,grants:[]})
 assert.equal((await records(manager,'pipeline')).items.some(r=>r.id===dealB.id),false);assert.equal((await records(manager,'openActivities')).items.some(r=>r.title==='External Beta follow-up'),false)
 await sharing.save('opportunities',dealB.id,{version:hidden.version+1,restricted:false,grants:[]})
 const profiles=createAccessRoleService(db,identity(admin)),assignment=await profiles.assignment(manager.id);await profiles.assign(manager.id,{version:assignment.accessPolicy.version,roleIds:[role.id],rules:{...rules,'enquiries.read':'OWN','opportunities.read':'OWN'}})
 assert.equal((await records(manager,'enquiries')).total,0);assert.equal((await records(manager,'pipeline')).total,0);assert.equal((await records(manager,'completedActivities',{introducedByCollaboratorId:a.id})).total,0)
 const restored=await profiles.assignment(manager.id);await profiles.assign(manager.id,{version:restored.accessPolicy.version,roleIds:[role.id],rules})
 const access=createOfficeAccessService(db,identity(admin)),membership=await access.getMemberships(manager.id);await access.saveMemberships(manager.id,{version:membership.version,officeIds:[],companies:[],creationOfficeId:null})
 for(const kind of ['enquiries','pipeline','openActivities','quotations','planDocuments'])assert.equal((await records(manager,kind)).total,0)
 assert.equal((await choices(manager)).total,0);const saved=await access.getMemberships(manager.id);await access.saveMemberships(manager.id,{version:saved.version,officeIds:['office_'+tenant],companies:[],creationOfficeId:'office_'+tenant})
})
test('module gating and current action/account revocation hide widgets and deny their selectors/drill-downs',async()=>{
 for(const key of ['crm','salesDocuments','paymentPlans']){
  await root.tenantModule.update({where:{tenantId_key:{tenantId:tenant,key}},data:{enabled:false}})
  const value=(await dashboard(manager).summary(selection)).data
  if(key==='crm'){assert.equal(value.enquiries,null);assert.equal(value.opportunities,null);assert.equal(value.activities,null);await assert.rejects(records(manager,'pipeline'),status(403))}
  if(key==='salesDocuments'){assert.equal(value.quotations,null);assert.equal(value.paymentPlans,null);await assert.rejects(records(manager,'quotations'),status(403))}
  if(key==='paymentPlans'){assert.equal(value.paymentPlans,null);assert.ok(value.quotations);await assert.rejects(records(manager,'planDocuments'),status(403))}
  await root.tenantModule.update({where:{tenantId_key:{tenantId:tenant,key}},data:{enabled:true}})
 }
 const profiles=createAccessRoleService(db,identity(admin)),assignment=await profiles.assignment(manager.id);await profiles.assign(manager.id,{version:assignment.accessPolicy.version,roleIds:[],rules})
 await assert.rejects(dashboard(manager).summary(selection),status(403));await assert.rejects(records(manager,'pipeline'),status(403));await assert.rejects(choices(manager),status(403))
 const restored=await profiles.assignment(manager.id);await profiles.assign(manager.id,{version:restored.accessPolicy.version,roleIds:[role.id],rules});await root.user.update({where:{id:manager.id},data:{status:'SUSPENDED'}});await assert.rejects(choices(manager),status(403));await root.user.update({where:{id:manager.id},data:{status:'ACTIVE'}})
})
test('saved attribution and supervisor remain after archive; filters and selection IDs cannot cross tenants or bypass validation',async()=>{
 await directory(admin).update(a.id,{version:a.version,archived:true});assert.equal((await choices(manager,{selectedId:a.id})).items[0].name,'Dashboard Alpha (DASH_A)')
 assert.equal((await dashboard(manager).summary({...selection,introductionSupervisorId:manager.id})).data.enquiries.total,1)
 assert.throws(()=>dashboard(manager).summary({...selection,introduction:'unattributed',introducedByCollaboratorId:a.id}),e=>e.name==='ZodError');assert.throws(()=>records(manager,'pipeline',{range:'custom',startDate:day,endDate:'2020-01-01'}),e=>e.name==='ZodError')
 assert.equal((await choices(manager,{selectedId:"' OR 1=1 --"})).total,0)
 const f=await root.user.create({data:{tenantId:foreign,role:'ADMIN',email:randomUUID()+'@example.test'}});await root.tenantModule.createMany({data:['crm','salesDocuments','paymentPlans'].map(key=>({tenantId:foreign,key,allowed:true,enabled:true}))})
 assert.equal((await createDashboardSalesService(other,identity(f)).choices({...selection,choice:'partner',selectedId:a.id})).total,0)
})
test('real-estate directory totals stay independent while project sales columns inherit attribution filters',async()=>{
 await root.tenantModule.create({data:{tenantId:tenant,key:'realEstate',allowed:true,enabled:true}})
 project=await createRealEstateService(db,identity(admin)).createProject({name:'Generic extension project',code:'DASH_PROJECT'})
 await root.realEstateEnquiryContext.create({data:{tenantId:tenant,enquiryId:lead.id,projectId:project.id}})
 const all=await dashboard(manager).summary(selection),external=await dashboard(manager).summary({...selection,responsibleType:'external'})
 assert.equal(all.data.projects.active,1);assert.equal(external.data.projects.active,1);assert.equal(all.data.projects.items[0].enquiries,1);assert.equal(external.data.projects.items[0].enquiries,0)
})
