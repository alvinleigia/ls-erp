/* eslint-disable @typescript-eslint/no-require-imports */
const {test,before,after}=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto'),{Pool}=require('pg'),{PrismaClient,Prisma}=require('@prisma/client')
const {TenantPgAdapter}=require('../lib/tenant-pg-adapter.ts'),{createApplicationCrmService}=require('../application/crm/service.ts'),{applicationSalesOrders}=require('../application/sales-orders/service.ts'),{applicationReceivables}=require('../application/receivables/service.ts'),{emptyQuotationContent}=require('../modules/sales-documents/quotation-validation.ts')
const {createCollaboratorService}=require('../platform/collaborators/service.ts'),{createOfficeAccessService}=require('../platform/companies/office-access.ts'),{createAccessRoleService}=require('../platform/access/service.ts'),{createRecordSharingService}=require('../platform/access/sharing-service.ts')
const {allPermissions}=require('../platform/access/catalog.ts'),{defaultRecordRules,supportedScopes}=require('../platform/access/rules.ts')
require('../lib/logger.ts').logger.info=()=>{}
const url=new URL(process.env.CRM_TEST_DATABASE_URL||'http://invalid');if(!['localhost','127.0.0.1'].includes(url.hostname)||url.pathname!='/ls_salon_crm_test')throw Error('Disposable localhost database only.')
const tenant='partner_finance_'+randomUUID(),foreign=tenant+'_foreign',clients=[],pools=[],identity=u=>({tenantId:u.tenantId,userId:u.id}),status=n=>e=>e.status===n
function client(tenantId,bypass=false){const u=new URL(url);if(!bypass){u.username='crm_test_runtime';u.password=''}const pool=new Pool({connectionString:u.toString(),max:4});pools.push(pool);const db=new PrismaClient({adapter:new TenantPgAdapter(pool,{tenantId,bypass})});clients.push(db);return db}
const root=client(undefined,true),db=client(tenant),other=client(foreign),crm=u=>createApplicationCrmService(db,identity(u)),directory=u=>createCollaboratorService(db,identity(u)),orders=u=>applicationSalesOrders(db,identity(u)),receivables=u=>applicationReceivables(db,identity(u))
const D=Prisma.Decimal
let admin,manager,staff,partner,partner2,a,b,contact,pipeline,stage,role,rules,alpha,beta,settled,unused
const choices=(user,extra={})=>receivables(user).attributionChoices({choice:'partner',status:'ALL',...extra})
async function financial(title,user,introducedByCollaboratorId,extra={}){
 const opportunity=await crm(admin).createOpportunity({title,contactId:contact.id,assignedUserId:user.id,pipelineId:pipeline.id,stageId:stage.id,amount:'100.25',currency:extra.currency||'INR',expectedCloseOn:'2030-01-01',...(introducedByCollaboratorId?{introducedByCollaboratorId}:{})})
 const content={...structuredClone(emptyQuotationContent),title,supplierName:'Generic services',currency:extra.currency||'INR',lines:[{description:'Professional services',quantity:'1',unit:'service',rate:extra.amount||'100.25'}]}
 const quotation=await crm(admin).saveQuotation(opportunity.id,{content}),order=await orders(admin).create({quotationId:quotation.id,revision:1})
 if(extra.unopened)return {opportunity,quotation,order}
 await orders(admin).transition(order.id,{action:'confirm',version:order.version})
 await receivables(admin).open(order.id,{dueDates:[extra.dueOn===undefined?'2020-01-01':extra.dueOn]})
 return {opportunity,quotation,order}
}
before(async()=>{
 await root.tenant.createMany({data:[tenant,foreign].map(id=>({id,slug:id,name:id}))})
 const user=(role,extra={})=>root.user.create({data:{tenantId:tenant,role,name:role,email:randomUUID()+'@example.test',...extra}})
 admin=await user('ADMIN');manager=await user('MANAGER');staff=await user('STAFF')
 await root.tenantModule.createMany({data:['crm','salesDocuments','salesOrders','receivables','paymentPlans'].map(key=>({tenantId:tenant,key,allowed:true,enabled:true}))})
 a=await directory(admin).create({name:'Finance Alpha',code:'FIN_A',supervisorUserId:manager.id});b=await directory(admin).create({name:'Finance Beta',code:'FIN_B',supervisorUserId:admin.id})
 partner=await user('STAFF',{collaboratorId:a.id});partner2=await user('STAFF',{collaboratorId:a.id})
 const access=createOfficeAccessService(db,identity(admin));for(const u of [admin,manager,staff,partner,partner2]){const p=await access.getMemberships(u.id);await access.saveMemberships(u.id,{version:p.version,officeIds:['office_'+tenant],companies:[],creationOfficeId:'office_'+tenant})}
 const profiles=createAccessRoleService(db,identity(admin));role=await profiles.save({name:'Financial reports',permissions:allPermissions.filter(p=>['contacts','enquiries','opportunities','pipelines','quotations','salesOrders','receivables','orderPayments'].includes(p.split('.')[0]))});rules=defaultRecordRules();for(const key of Object.keys(rules))if(supportedScopes(key.split('.')[0]).includes('ALL'))rules[key]='ALL'
 const assignment=await profiles.assignment(manager.id);await profiles.assign(manager.id,{version:assignment.accessPolicy.version,roleIds:[role.id],rules})
 contact=await crm(admin).createContact({name:'Generic financial customer'});pipeline=await crm(admin).createPipeline({name:'Generic services',stages:[{name:'Open',kind:'OPEN',probability:10,color:'#123456'},{name:'Won',kind:'WON',probability:100,color:'#00aa00'},{name:'Lost',kind:'LOST',probability:0,color:'#aa0000'}]});stage=(await crm(admin).getPipeline(pipeline.id)).stages[0]
 alpha=await financial('Internal Alpha',staff,a.id);await financial('External Alpha',partner,a.id,{amount:'200.50',dueOn:null});await financial('No recorded partner',partner2,null,{amount:'300.75'});beta=await financial('Beta USD',staff,b.id,{currency:'USD',amount:'400.80'})
 settled=await financial('Settled Alpha',staff,a.id,{amount:'50.10'});await receivables(admin).record(settled.order.id,{requestKey:randomUUID(),version:1,amount:'50.10',receivedOn:'2020-01-01',method:'CASH',reference:'',note:''})
 unused=await directory(admin).create({name:'No opened balance',code:'UNUSED',supervisorUserId:admin.id});await financial('Unopened partner order',staff,unused.id,{unopened:true})
})
after(async()=>{await Promise.all(clients.map(c=>c.$disconnect()));await Promise.all(pools.map(p=>p.end()))})

test('financial identity and introduction independently partition balances without multiplying partner logins',async()=>{
 const all=await receivables(manager).list({status:'ALL'});assert.equal(all.total,5)
 for(const [first,second] of [[{responsibleType:'internal'},{responsibleType:'external'}],[{introduction:'partner'},{introduction:'unattributed'}]]){
  const x=await receivables(manager).list({status:'ALL',...first}),y=await receivables(manager).list({status:'ALL',...second});assert.equal(x.total+y.total,all.total)
  for(const summary of all.summaries)for(const key of ['total','paid','outstanding','overdue','current','unscheduled','days1to30','days31to60','days61to90','days91plus'])assert.equal(new D(x.summaries.find(r=>r.currency===summary.currency)?.[key]||0).plus(y.summaries.find(r=>r.currency===summary.currency)?.[key]||0).toString(),summary[key])
 }
 assert.equal((await receivables(manager).list({status:'ALL',introducedByCollaboratorId:a.id,responsibleType:'internal'})).total,2)
 assert.equal((await receivables(manager).list({status:'ALL',introduction:'unattributed',responsibleType:'external'})).total,1)
})
test('filtered paging, financial search, status, currency, ageing and saved-supervisor totals reconcile',async()=>{
 for(const filter of [{introducedByCollaboratorId:a.id},{introductionSupervisorId:manager.id},{introduction:'partner'},{introduction:'unattributed'},{responsibleType:'external'},{q:'Alpha'},{currency:'USD'},{status:'SETTLED'},{status:'OVERDUE'}]){
  const input={status:'ALL',...filter},first=await receivables(manager).list({...input,pageSize:1}),rows=[]
  for(let page=1;page<=first.totalPages;page++)rows.push(...(await receivables(manager).list({...input,page,pageSize:1})).items)
  assert.equal(rows.length,first.total);assert.equal(new Set(rows.map(r=>r.orderId)).size,first.total)
  for(const summary of first.summaries)for(const key of ['total','paid','outstanding','overdue'])assert.equal(rows.filter(r=>r.currency===summary.currency).reduce((n,r)=>n.plus(r[key]),new D(0)).toString(),summary[key])
 }
 assert.equal((await receivables(manager).list({introducedByCollaboratorId:a.id})).summaries[0].unscheduled,'200.5')
})
test('financial choices use matching balances, including row search/status/currency, with identical selected/count/page scope',async()=>{
 const all=await choices(manager,{pageSize:1});assert.equal(all.total,2);assert.equal((await choices(manager,{pageSize:1,page:2})).items.length,1)
 assert.equal((await choices(manager,{selectedId:unused.id})).total,0)
 assert.equal((await choices(manager,{recordQuery:'Internal Alpha',selectedId:a.id})).total,1);assert.equal((await choices(manager,{recordQuery:'Internal Alpha',selectedId:b.id})).total,0)
 assert.equal((await choices(manager,{currency:'USD',selectedId:a.id})).total,0);assert.equal((await choices(manager,{currency:'USD',selectedId:b.id})).total,1)
 assert.equal((await choices(manager,{status:'SETTLED',selectedId:b.id})).total,0)
 assert.equal((await choices(manager,{q:'Alpha',selectedId:a.id})).total,1);assert.equal((await choices(manager,{q:'Beta',selectedId:a.id})).total,0)
 assert.equal((await choices(manager,{choice:'supervisor',selectedId:manager.id})).items[0].id,manager.id)
})
test('financial Read remains available without sales Read; origin filters and choices never infer hidden source evidence',async()=>{
 const profiles=createAccessRoleService(db,identity(admin));let assignment=await profiles.assignment(manager.id)
 await profiles.assign(manager.id,{version:assignment.accessPolicy.version,roleIds:[role.id],rules:{...rules,'opportunities.read':'OWN'}})
 assert.equal((await receivables(manager).list({status:'ALL'})).total,5);assert.equal((await receivables(manager).list({status:'ALL',introduction:'partner'})).total,0);assert.equal((await choices(manager)).total,0)
 const finance=await profiles.save({name:'Financial Read without sales Read',permissions:['salesOrders.read','receivables.read']});assignment=await profiles.assignment(manager.id);await profiles.assign(manager.id,{version:assignment.accessPolicy.version,roleIds:[finance.id],rules})
 assert.equal((await receivables(manager).list({status:'ALL'})).total,5);assert.equal((await receivables(manager).list({responsibleType:'external'})).total,2)
 await assert.rejects(receivables(manager).list({introduction:'unattributed'}),status(403));await assert.rejects(choices(manager),status(403))
 assignment=await profiles.assignment(manager.id);await profiles.assign(manager.id,{version:assignment.accessPolicy.version,roleIds:[role.id],rules})
})
test('explicit financial sharing cannot supply source attribution outside source Read or bypass Restricted records',async()=>{
 const profiles=createAccessRoleService(db,identity(admin)),sharing=createRecordSharingService(db,identity(admin));let assignment=await profiles.assignment(manager.id)
 const policy=await sharing.get('salesOrders',alpha.order.id);await sharing.save('salesOrders',alpha.order.id,{version:policy.version,restricted:false,grants:[{kind:'USER',id:manager.id,level:'READ'}]})
 await profiles.assign(manager.id,{version:assignment.accessPolicy.version,roleIds:[role.id],rules:{...rules,'opportunities.read':'OWN','salesOrders.read':'OWN','receivables.read':'OWN'}})
 assert.equal((await receivables(manager).list({status:'ALL'})).total,1);assert.equal((await receivables(manager).list({introducedByCollaboratorId:a.id})).total,0);assert.equal((await choices(manager)).total,0)
 assignment=await profiles.assignment(manager.id);await profiles.assign(manager.id,{version:assignment.accessPolicy.version,roleIds:[role.id],rules})
 const hidden=await sharing.get('opportunities',beta.opportunity.id);await sharing.save('opportunities',beta.opportunity.id,{version:hidden.version,restricted:true,grants:[]})
 assert.equal((await choices(manager,{selectedId:b.id})).total,0);assert.equal((await receivables(manager).list({introducedByCollaboratorId:b.id})).total,0)
 await sharing.save('opportunities',beta.opportunity.id,{version:hidden.version+1,restricted:false,grants:[]})
})
test('payments/reversals use canonical numeric balances while partner filters remain source-derived',async()=>{
 const payment=await receivables(admin).record(alpha.order.id,{requestKey:randomUUID(),version:1,amount:'20.25',receivedOn:'2020-01-01',method:'CASH',reference:'',note:''})
 let row=(await receivables(manager).list({q:'Internal Alpha',introducedByCollaboratorId:a.id})).items[0];assert.equal(row.paid,'20.25');assert.equal(row.outstanding,'80')
 await receivables(admin).reverse(alpha.order.id,payment.id,{requestKey:randomUUID(),version:2,kind:'CORRECTION',reason:'Synthetic correction',effectiveOn:'2020-01-01',reference:''})
 row=(await receivables(manager).list({q:'Internal Alpha',introducedByCollaboratorId:a.id})).items[0];assert.equal(row.paid,'0');assert.equal(row.outstanding,'100.25')
})
test('saved attribution survives partner rename/supervisor/archive and owner reassignment changes only salesperson type',async()=>{
 const saved=await root.externalCollaborator.findUnique({where:{id:a.id}})
 await directory(admin).update(a.id,{version:saved.version,name:'Renamed finance agency',supervisorUserId:admin.id})
 const current=await root.externalCollaborator.findUnique({where:{id:a.id}});await directory(admin).update(a.id,{version:current.version,archived:true})
 assert.equal((await choices(manager,{selectedId:a.id})).items[0].name,'Finance Alpha (FIN_A)');assert.equal((await receivables(manager).list({status:'ALL',introductionSupervisorId:manager.id})).total,3)
 await root.crmOpportunity.update({where:{id:alpha.opportunity.id},data:{assignedUserId:partner.id}})
 assert.equal((await receivables(manager).list({q:'Internal Alpha',responsibleType:'external',introducedByCollaboratorId:a.id})).total,1)
 const evidence=await root.crmOpportunity.findUnique({where:{id:alpha.opportunity.id}});assert.equal(evidence.partnerAttribution.name,'Finance Alpha');assert.equal(evidence.partnerAttribution.supervisorUserId,manager.id)
})
test('None, office removal, module/account revocation, foreign selections and malformed filters fail closed',async()=>{
 assert.throws(()=>receivables(manager).list({introduction:'unattributed',introducedByCollaboratorId:a.id}),e=>e.name==='ZodError')
 assert.equal((await choices(manager,{selectedId:"' OR 1=1 --"})).total,0)
 const fAdmin=await root.user.create({data:{tenantId:foreign,role:'ADMIN',email:randomUUID()+'@example.test'}});await root.tenantModule.createMany({data:['crm','salesDocuments','salesOrders','receivables'].map(key=>({tenantId:foreign,key,allowed:true,enabled:true}))})
 assert.equal((await applicationReceivables(other,identity(fAdmin)).attributionChoices({choice:'partner',selectedId:a.id})).total,0)
 const access=createOfficeAccessService(db,identity(admin)),membership=await access.getMemberships(manager.id);await access.saveMemberships(manager.id,{version:membership.version,officeIds:[],companies:[],creationOfficeId:null})
 assert.equal((await receivables(manager).list({status:'ALL'})).total,0);assert.equal((await choices(manager)).total,0)
 const restored=await access.getMemberships(manager.id);await access.saveMemberships(manager.id,{version:restored.version,officeIds:['office_'+tenant],companies:[],creationOfficeId:'office_'+tenant})
 const profiles=createAccessRoleService(db,identity(admin)),assignment=await profiles.assignment(manager.id);await profiles.assign(manager.id,{version:assignment.accessPolicy.version,roleIds:[role.id],rules:{...rules,'receivables.read':'NONE'}})
 await assert.rejects(receivables(manager).list({status:'ALL'}),status(403));await assert.rejects(choices(manager),status(403))
 const restoredRole=await profiles.assignment(manager.id);await profiles.assign(manager.id,{version:restoredRole.accessPolicy.version,roleIds:[role.id],rules})
 await root.tenantModule.update({where:{tenantId_key:{tenantId:tenant,key:'receivables'}},data:{enabled:false}});await assert.rejects(choices(manager),status(403));await root.tenantModule.update({where:{tenantId_key:{tenantId:tenant,key:'receivables'}},data:{enabled:true}})
 await root.user.update({where:{id:manager.id},data:{status:'SUSPENDED'}});await assert.rejects(receivables(manager).list({}),status(403));await assert.rejects(choices(manager),status(403))
})
