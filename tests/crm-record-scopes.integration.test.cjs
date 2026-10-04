/* eslint-disable @typescript-eslint/no-require-imports */
const {test,before,after}=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto'),{Pool}=require('pg')
const {PrismaClient}=require('@prisma/client'),{TenantPgAdapter}=require('../lib/tenant-pg-adapter.ts')
const {createApplicationCrmService}=require('../application/crm/service.ts'),{createAccessRoleService}=require('../platform/access/service.ts')
const {allPermissions}=require('../platform/access/catalog.ts'),{emptyQuotationContent}=require('../modules/sales-documents/quotation-validation.ts')
require('../lib/logger.ts').logger.info=()=>{}
const url=new URL(process.env.CRM_TEST_DATABASE_URL||'http://invalid');if(!['localhost','127.0.0.1'].includes(url.hostname)||url.pathname!='/ls_salon_crm_test')throw Error('Disposable local database only.')
const tenant=`scopes_${randomUUID()}`,foreign=`scopes_${randomUUID()}`,pools=[],clients=[],queries=[]
function client(tenantId,bypass=false){const u=new URL(url);if(!bypass){u.username='crm_test_runtime';u.password=''}const pool=new Pool({connectionString:u.toString(),max:3});pools.push(pool);const db=new PrismaClient({adapter:new TenantPgAdapter(pool,{tenantId,bypass}),log:[{emit:'event',level:'query'}]});db.$on('query',e=>queries.push(e.query));clients.push(db);return db}
const root=client(undefined,true),db=client(tenant),otherDb=client(foreign),unscoped=client(undefined)
const identity=u=>({tenantId:u.tenantId,userId:u.id,requestId:'scope-test'}),denied=code=>e=>e.status===code
let admin,manager,a,b,peer,foreignAdmin,crm,limited,staff,roles,role,teamA,teamB,ownContact,contactA,contactB,own,leadA,leadB,dealA,dealB,workA,workB,quoteA,quoteB
const leadEdit=(row,extra={})=>({title:row.title,assignedUserId:row.assignedUserId,status:row.status,version:row.version,...extra})
async function scope(value,permissions=allPermissions){role=await roles.save({name:role.name,permissions,crmRecordScope:value,version:role.version},role.id)}
async function managerFlag(team,user,isManager){const fresh=await crm.getSalesTeam(team.id);return crm.changeSalesTeamMember(team.id,{userId:user.id,isManager,version:fresh.version})}
before(async()=>{
 await root.tenant.createMany({data:[tenant,foreign].map(id=>({id,slug:id,name:id}))})
 const user=(tenantId,role)=>root.user.create({data:{tenantId,role,name:role,email:`${randomUUID()}@example.test`}})
 admin=await user(tenant,'ADMIN');manager=await user(tenant,'MANAGER');peer=await user(tenant,'MANAGER');a=await user(tenant,'STAFF');b=await user(tenant,'STAFF');foreignAdmin=await user(foreign,'ADMIN')
 await root.tenantModule.createMany({data:[tenant,foreign].flatMap(tenantId=>['crm','salesDocuments','paymentPlans'].map(key=>({tenantId,key,allowed:true,enabled:true})))})
 crm=createApplicationCrmService(db,identity(admin));limited=createApplicationCrmService(db,identity(manager));staff=createApplicationCrmService(db,identity(a));roles=createAccessRoleService(db,identity(admin))
 role=await roles.save({name:'Scoped manager',permissions:allPermissions});await roles.assign(manager.id,{roleId:role.id,previousRoleId:null})
 async function team(name,members){let t=await crm.saveSalesTeam({name,workflow:'ENQUIRY_FIRST'});for(const u of members)t=await crm.changeSalesTeamMember(t.id,{userId:u.id,version:t.version});return t}
 teamA=await team('Team A',[manager,peer,a]);teamB=await team('Team B',[manager,b])
 const contact=(owner,name)=>root.crmContact.create({data:{tenantId:tenant,ownerUserId:owner.id,name}})
 ownContact=await contact(manager,'Own customer');contactA=await contact(a,'Team A customer');contactB=await contact(b,'Team B customer')
 own=await crm.createEnquiry({title:'Own lead',contactId:ownContact.id,assignedUserId:manager.id})
 leadA=await crm.createEnquiry({title:'Team A lead',contactId:contactA.id,assignedUserId:a.id,salesTeamId:teamA.id});leadB=await crm.createEnquiry({title:'Team B lead',contactId:contactB.id,assignedUserId:b.id,salesTeamId:teamB.id})
 leadA=await crm.updateEnquiry(leadA.id,leadEdit(leadA,{status:'QUALIFIED'}));leadB=await crm.updateEnquiry(leadB.id,leadEdit(leadB,{status:'QUALIFIED'}))
 const pipeline=await root.crmPipeline.create({data:{tenantId:tenant,name:'Sales'}}),stage=await root.crmStage.create({data:{tenantId:tenant,pipelineId:pipeline.id,name:'Qualified',kind:'OPEN',position:0,probability:10,color:'#123456'}})
 const deal=(lead)=>crm.createOpportunity({enquiryId:lead.id,enquiryVersion:lead.version,title:lead.title+' deal',contactId:lead.contactId,assignedUserId:lead.assignedUserId,salesTeamId:lead.salesTeamId,pipelineId:pipeline.id,stageId:stage.id,amount:'100',currency:'INR',expectedCloseOn:'2030-12-31'})
 dealA=await deal(leadA);dealB=await deal(leadB)
 const work=(deal)=>crm.createWork({title:'Follow up '+deal.title,contactId:deal.contactId,opportunityId:deal.id,assignedUserId:deal.assignedUserId,type:'CALL',callDirection:'OUTBOUND',dueOn:'2030-10-07'})
 workA=await work(dealA);workB=await work(dealB)
 const content={...structuredClone(emptyQuotationContent),supplierName:'Example',currency:'INR',lines:[{description:'Unit',quantity:'1',unit:'unit',rate:'100'}]}
 quoteA=await crm.saveQuotation(dealA.id,{content});quoteB=await crm.saveQuotation(dealB.id,{content})
})
after(async()=>{await Promise.all(clients.map(c=>c.$disconnect()));await Promise.all(pools.map(p=>p.end()))})
test('legacy access is preserved and own scope filters list/detail/edit/export without changing ownership',async()=>{
 assert.equal((await limited.listEnquiries({})).total,3)
 await scope('OWN')
 assert.deepEqual((await limited.listEnquiries({})).items.map(r=>r.id),[own.id])
 assert.equal((await limited.listEnquiries({assignedUserId:b.id})).total,0)
 assert.equal((await limited.listEnquiries({},true)).items.length,1)
 for(const action of [()=>limited.getEnquiry(leadB.id),()=>limited.updateEnquiry(leadB.id,leadEdit(leadB)),()=>limited.getContact(contactB.id),()=>limited.updateContact(contactB.id,{name:'No',archived:false,version:contactB.version}),()=>limited.getOpportunity(dealB.id),()=>limited.getWork(workB.id),()=>limited.listWorkHistory(workB.id,{}),()=>limited.getQuotation(quoteB.id,undefined,true)])await assert.rejects(action(),denied(404))
 own=await limited.updateEnquiry(own.id,leadEdit(own,{title:'Manager edited own'}));assert.equal(own.assignedUserId,manager.id)
 assert.equal((await limited.listAssignees({})).total,1)
})
test('membership alone grants no managed-team access; only administrators designate managers',async()=>{
 await scope('MANAGED_TEAMS');assert.equal((await limited.listEnquiries({})).total,1)
 const current=await crm.getSalesTeam(teamA.id)
 await assert.rejects(limited.changeSalesTeamMember(teamA.id,{userId:manager.id,isManager:true,version:current.version}),denied(403))
 await assert.rejects(crm.changeSalesTeamMember(teamA.id,{userId:a.id,isManager:true,version:current.version}),denied(400))
 teamA=await managerFlag(teamA,manager,true)
 assert.equal((await limited.listEnquiries({})).total,2)
 await assert.rejects(limited.getEnquiry(leadB.id),denied(404))
 const audit=await root.auditLog.findFirst({where:{tenantId:tenant,event:'crm.team.manager.updated',entityId:teamA.id}})
 assert.equal(audit.actorUserId,admin.id);assert.equal(audit.before.isManager,false);assert.equal(audit.after.isManager,true)
 const member=await crm.listSalesTeamMembers(teamA.id,{});assert.equal(member.items.find(u=>u.id===manager.id).isManager,true)
})
test('managed reads include linked customers, work, quotations and queries; edits retain owner and actor audit',async()=>{
 assert.equal((await limited.getContact(contactA.id)).id,contactA.id)
 assert.equal((await limited.listOpportunities({})).total,1);assert.equal((await limited.listOpportunities({},true)).items.length,1)
 assert.equal((await limited.listWork({scope:'visible'})).total,1);assert.equal((await limited.getWork(workA.id)).parent.id,dealA.id)
 assert.equal((await limited.listQuotations(undefined,{})).total,1);assert.equal((await limited.getQuotation(quoteA.id)).id,quoteA.id)
 leadA=await limited.updateEnquiry(leadA.id,leadEdit(leadA,{title:'Managed edit'}));assert.equal(leadA.assignedUserId,a.id)
 const audit=await root.auditLog.findFirst({where:{tenantId:tenant,entityId:leadA.id,event:'crm.enquiry.updated',actorUserId:manager.id}});assert.equal(audit.actorUserId,manager.id)
 assert.equal((await limited.listAssignees({})).items.some(u=>u.id===b.id),false)
 await assert.rejects(limited.updateEnquiry(leadA.id,leadEdit(leadA,{assignedUserId:b.id,salesTeamId:teamB.id})),e=>[400,403].includes(e.status))
 await assert.rejects(limited.addWorkNote(workB.id,{message:'No'}),denied(404))
})
test('linked business accounts and contact writes inherit the same sales boundary',async()=>{
 const account=contact=>root.crmAccount.create({data:{tenantId:tenant,name:contact.name+' account',ownerUserId:contact.ownerUserId,contacts:{create:{contactId:contact.id}}}})
 const visible=await account(contactA),hidden=await account(contactB)
 assert.equal((await limited.getAccount(visible.id)).id,visible.id)
 assert.equal((await limited.listAccounts({})).total,1)
 await assert.rejects(limited.getAccount(hidden.id),denied(404))
 await assert.rejects(limited.updateAccount(hidden.id,{name:'Hidden edit',archived:false,version:hidden.version}),denied(404))
 await limited.updateContact(contactA.id,{name:'Managed customer edit',archived:false,version:contactA.version})
 assert.equal((await root.crmContact.findUnique({where:{id:contactA.id}})).ownerUserId,a.id)
 await assert.rejects(limited.linkContactAccount(contactA.id,{accountId:hidden.id}),e=>[400,404].includes(e.status))
})

test('audit failure rolls back team-manager authority and version',async()=>{
 const fault=new Proxy(db,{get(target,key){
  if(key==='$transaction')return(operation,options)=>target.$transaction(tx=>operation(new Proxy(tx,{get(inner,prop){
   if(prop==='auditLog')return{create:async()=>{throw Error('audit unavailable')}}
   const value=inner[prop];return typeof value==='function'?value.bind(inner):value
  }})),options)
  const value=target[key];return typeof value==='function'?value.bind(target):value
 }})
 const current=await crm.getSalesTeam(teamA.id)
 await assert.rejects(createApplicationCrmService(fault,identity(admin)).changeSalesTeamMember(teamA.id,{userId:manager.id,isManager:false,version:current.version}),/audit unavailable/)
 assert.equal((await crm.getSalesTeam(teamA.id)).version,current.version)
 assert.equal((await limited.listEnquiries({})).total,2)
 const saved=await roles.save({name:role.name,permissions:allPermissions,version:role.version},role.id)
 assert.equal(saved.crmRecordScope,'MANAGED_TEAMS');role=saved
})

test('activity and SQL sales reports respect managed scope before aggregation, pagination and export',async()=>{
 const q={scope:'team',from:new Date(Date.now()-86400000).toISOString().slice(0,10),through:new Date().toISOString().slice(0,10)}
 const overview=await limited.activityOverview(q);assert.equal(overview.totals.open,1)
 const report=await limited.staffActivityReport(q);assert.equal(report.items.some(u=>u.id===b.id),false)
 const hidden=await limited.activityOverview({...q,assignedUserId:b.id});assert.equal(hidden.totals.open,0)
 const rows=await limited.salesReportRecords({...q,view:'leads'});assert.equal(rows.total,2);assert.equal(rows.items.some(r=>r.id===leadB.id),false)
 const csv=await limited.exportSalesReport({...q,view:'leads'});assert.equal(JSON.stringify(csv).includes('Team B lead'),false)
})
test('former team members retain attributed visible work without allowing new assignments',async()=>{
 const fields={title:'Former member work',contactId:contactA.id,opportunityId:dealA.id,assignedUserId:peer.id,type:'TASK',dueOn:'2030-10-07'}
 const task=await crm.createWork(fields)
 const current=await crm.getSalesTeam(teamA.id)
 await crm.changeSalesTeamMember(teamA.id,{userId:peer.id,remove:true,version:current.version})
 const report=await limited.staffActivityReport({scope:'team'})
 assert.equal(report.items.find(u=>u.id===peer.id).open,1)
 const {contactId,opportunityId,...update}=fields;assert.ok(contactId&&opportunityId)
 const edited=await limited.updateWork(task.id,{...update,title:'Manager correction',status:'OPEN',version:task.version})
 assert.equal(edited.assignedUserId,peer.id)
 await assert.rejects(limited.createWork(fields),denied(400))
})

test('scope and team revocation take effect without login; explicit All stays tenant-bound and actions still apply',async()=>{
 await managerFlag(teamA,manager,false);await assert.rejects(limited.getEnquiry(leadA.id),denied(404))
 await scope('ALL');assert.equal((await limited.listEnquiries({})).total,3)
 const other=createApplicationCrmService(otherDb,identity(foreignAdmin));await assert.rejects(other.getEnquiry(leadA.id),denied(404));assert.equal(await unscoped.crmEnquiry.count(),0)
 await scope('ALL',['enquiries.read']);await assert.rejects(limited.updateEnquiry(leadA.id,leadEdit(leadA)),denied(403))
 await roles.assign(a.id,{roleId:role.id,previousRoleId:null});assert.equal((await staff.listEnquiries({})).total,1);await assert.rejects(staff.getEnquiry(leadB.id),denied(404))
 await roles.assign(a.id,{roleId:null,previousRoleId:role.id})
 await scope('MANAGED_TEAMS');await managerFlag(teamA,manager,true)
 const before=await crm.getSalesTeam(teamA.id);await crm.saveSalesTeam({name:before.name,workflow:before.workflow,version:before.version,archived:true},teamA.id)
 await assert.rejects(limited.getEnquiry(leadA.id),denied(404))
 const archived=await crm.getSalesTeam(teamA.id);await crm.saveSalesTeam({name:archived.name,workflow:archived.workflow,version:archived.version,archived:false},teamA.id)
})
test('scoped manager cannot obtain unrelated parent details through an assigned activity',async()=>{
 const task=await root.crmTask.create({data:{tenantId:tenant,title:'Assigned handoff',contactId:contactB.id,opportunityId:dealB.id,assignedUserId:manager.id,createdByUserId:admin.id,type:'CALL',callDirection:'OUTBOUND',dueOn:new Date('2030-10-07')}})
 const row=await limited.getWork(task.id);assert.equal(row.parent,null);assert.equal(row.opportunityId,null)
})
test('ten thousand sales rows retain bounded queries under managed scope',async()=>{
 await root.crmEnquiry.createMany({data:Array.from({length:10000},(_,i)=>({tenantId:tenant,title:`Scale ${i}`,contactId:i%2?contactA.id:contactB.id,assignedUserId:i%2?a.id:b.id,salesTeamId:i%2?teamA.id:teamB.id}))})
 queries.length=0;const rows=await limited.listEnquiries({q:'Scale',pageSize:5});const count=queries.length
 assert.equal(rows.total,5000);assert.equal(rows.items.length,5);assert.ok(count<=16,`Unbounded query count: ${count}`)
 console.log(`Managed-team scope: 10,000 rows, ${count} queries, 5 paginated results`)
})
