/* eslint-disable @typescript-eslint/no-require-imports */
const {test,before,after}=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto'),{Pool}=require('pg'),{PrismaClient}=require('@prisma/client')
const {TenantPgAdapter}=require('../lib/tenant-pg-adapter.ts'),{runWithDatabaseActor}=require('../lib/database-actor.ts')
const {createApplicationCrmService}=require('../application/crm/service.ts'),{createAccessRoleService}=require('../platform/access/service.ts'),{createRecordSharingService}=require('../platform/access/sharing-service.ts')
const {allPermissions}=require('../platform/access/catalog.ts'),{defaultRecordRules,supportedScopes}=require('../platform/access/rules.ts')
const {applicationSalesOrders}=require('../application/sales-orders/service.ts'),{applicationReceivables}=require('../application/receivables/service.ts'),{emptyQuotationContent}=require('../modules/sales-documents/quotation-validation.ts')
require('../lib/logger.ts').logger.info=()=>{}
const url=new URL(process.env.CRM_TEST_DATABASE_URL||'http://invalid')
if(!['localhost','127.0.0.1'].includes(url.hostname)||url.pathname!='/ls_salon_crm_test')throw Error('Use only the disposable local database.')
const tenant='sharing_'+randomUUID(),foreign='sharing_'+randomUUID(),clients=[],pools=[]
function client(tenantId,bypass=false){const u=new URL(url);if(!bypass){u.username='crm_test_runtime';u.password=''}const pool=new Pool({connectionString:u.toString(),max:4});pools.push(pool);const db=new PrismaClient({adapter:new TenantPgAdapter(pool,{tenantId,bypass})});clients.push(db);return db}
const root=client(undefined,true),db=client(tenant),other=client(foreign),identity=u=>({tenantId:u.tenantId,userId:u.id}),status=n=>e=>e.status===n
let admin,owner,recipient,manager,noProfile,foreignAdmin,crm,sharing,staffCrm,viewer,managerCrm,roles,profile,contact,lead,team
const grant=(user,level='READ')=>({kind:'USER',id:user.id,level})
const direct=(user,fn)=>runWithDatabaseActor(user.id,fn)
async function setSharing(resource,id,restricted,grants=[]){const current=await sharing.get(resource,id);return sharing.save(resource,id,{version:current.version,restricted,grants})}
before(async()=>{
 await root.tenant.createMany({data:[tenant,foreign].map(id=>({id,slug:id,name:id}))})
 const user=(tenantId,role)=>root.user.create({data:{tenantId,role,name:role+' '+randomUUID().slice(0,5),email:randomUUID()+'@example.test'}})
 admin=await user(tenant,'ADMIN');owner=await user(tenant,'STAFF');recipient=await user(tenant,'STAFF');manager=await user(tenant,'MANAGER');noProfile=await user(tenant,'STAFF');foreignAdmin=await user(foreign,'ADMIN')
 await root.tenantModule.createMany({data:[tenant,foreign].flatMap(tenantId=>['crm','realEstate','salesDocuments','salesOrders','receivables','paymentPlans','catalog'].map(key=>({tenantId,key,allowed:true,enabled:true})))})
 roles=createAccessRoleService(db,identity(admin));profile=await roles.save({name:'Sharing checks',permissions:allPermissions})
 for(const user of [owner,recipient,manager]){const current=await roles.assignment(user.id),rules=defaultRecordRules();if(user===manager)for(const permission of Object.keys(rules))if(supportedScopes(permission.split('.')[0]).includes('ALL'))rules[permission]='ALL';await roles.assign(user.id,{roleIds:[profile.id],rules,version:current.accessPolicy.version})}
 crm=createApplicationCrmService(db,identity(admin));sharing=createRecordSharingService(db,identity(admin));staffCrm=createApplicationCrmService(db,identity(owner));viewer=createApplicationCrmService(db,identity(recipient));managerCrm=createApplicationCrmService(db,identity(manager))
 contact=await crm.createContact({name:'Sharing customer'});lead=await crm.createEnquiry({title:'Restricted customer enquiry',contactId:contact.id,assignedUserId:owner.id})
 team=await root.businessTeam.create({data:{tenantId:tenant,name:'Shared access team',nameKey:'shared access team'}})
})
after(async()=>{await Promise.all(clients.map(c=>c.$disconnect()));await Promise.all(pools.map(p=>p.end()))})

test('explicit read-only sharing extends Own access without granting edit, assignment or configuration authority',async()=>{
 await assert.rejects(viewer.getEnquiry(lead.id),status(404))
 await setSharing('enquiries',lead.id,false,[grant(recipient)])
 const read=await viewer.getEnquiry(lead.id)
 assert.equal(read.id,lead.id);assert.equal(read.recordAccess.permissions['enquiries.edit'],false)
 await assert.rejects(viewer.updateEnquiry(lead.id,{title:'Denied',assignedUserId:owner.id,status:'NEW',version:lead.version}),status(404))
 await assert.rejects(createRecordSharingService(db,identity(recipient)).get('enquiries',lead.id),status(403))
 await assert.rejects(createRecordSharingService(db,identity(recipient)).save('enquiries',lead.id,{version:1,restricted:false,grants:[]}),status(403))
 assert.equal((await viewer.listEnquiries({})).items[0].id,lead.id)
 assert.equal((await viewer.getContact(contact.id)).id,contact.id)
})

test('Restricted mode caps tenant-wide ordinary managers, SQL, exports, revisions and audit copies',async()=>{
 await setSharing('enquiries',lead.id,true,[grant(recipient)])
 assert.equal((await staffCrm.getEnquiry(lead.id)).id,lead.id)
 await assert.rejects(managerCrm.getEnquiry(lead.id),status(404))
 assert.equal((await managerCrm.listEnquiries({q:'Restricted customer enquiry'})).total,0)
 assert.equal((await managerCrm.listEnquiries({q:'Restricted customer enquiry'},true)).total,0)
 assert.equal(await direct(manager,()=>db.crmEnquiry.count({where:{id:lead.id}})),0)
 const [raw]=await direct(manager,()=>db.$queryRaw`SELECT count(*)::int n FROM "CrmEnquiry" WHERE id=${lead.id}`);assert.equal(raw.n,0)
 assert.equal(await direct(manager,()=>db.auditLog.count({where:{entityId:lead.id}})),0)
 assert.equal((await crm.getEnquiry(lead.id)).id,lead.id)
})

test('sharing cannot grant missing profiles or a None record rule',async()=>{
 await setSharing('enquiries',lead.id,true,[grant(recipient),grant(noProfile,'EDIT')])
 await assert.rejects(createApplicationCrmService(db,identity(noProfile)).getEnquiry(lead.id),status(403))
 const current=await roles.assignment(recipient.id)
 await roles.assign(recipient.id,{roleIds:[profile.id],version:current.accessPolicy.version,rules:{...current.accessPolicy.rules,'enquiries.read':'NONE'}})
 await assert.rejects(viewer.getEnquiry(lead.id),status(403))
 const denied=await roles.assignment(recipient.id);await roles.assign(recipient.id,{roleIds:[profile.id],version:denied.accessPolicy.version,rules:current.accessPolicy.rules})
})

test('team membership grants explicit shared access; revocation and archived teams take effect immediately',async()=>{
 await setSharing('enquiries',lead.id,true,[{kind:'TEAM',id:team.id,level:'READ'}])
 await assert.rejects(viewer.getEnquiry(lead.id),status(404))
 await root.businessTeamMember.create({data:{tenantId:tenant,teamId:team.id,userId:recipient.id}})
 assert.equal((await viewer.getEnquiry(lead.id)).recordAccess.permissions['enquiries.edit'],false)
 await root.businessTeam.update({where:{tenantId_id:{tenantId:tenant,id:team.id}},data:{archived:true}})
 await assert.rejects(viewer.getEnquiry(lead.id),status(404))
 await root.businessTeam.update({where:{tenantId_id:{tenantId:tenant,id:team.id}},data:{archived:false}})
 assert.equal((await viewer.getEnquiry(lead.id)).id,lead.id)
 await root.businessTeamMember.delete({where:{tenantId_teamId_userId:{tenantId:tenant,teamId:team.id,userId:recipient.id}}})
 await assert.rejects(viewer.getEnquiry(lead.id),status(404))
})

test('Edit sharing uses the strongest active grant and activity controls follow the same scoped actions',async()=>{
 const enquiry=await crm.createEnquiry({title:'Shared editing',contactId:contact.id,assignedUserId:owner.id})
 const task=await crm.createTask(enquiry.id,{title:'Shared activity',dueOn:'2030-01-01'})
 await root.businessTeamMember.create({data:{tenantId:tenant,teamId:team.id,userId:recipient.id}})
 try{
  await setSharing('enquiries',enquiry.id,true,[grant(recipient),{kind:'TEAM',id:team.id,level:'EDIT'}])
  await setSharing('activities',task.id,true,[grant(recipient),{kind:'TEAM',id:team.id,level:'EDIT'}])
  const shared=await viewer.getEnquiry(enquiry.id)
  assert.equal(shared.recordAccess.permissions['enquiries.edit'],true)
  const edited=await viewer.updateEnquiry(enquiry.id,{title:'Shared editing saved',assignedUserId:owner.id,status:'NEW',version:shared.version})
  assert.equal(edited.title,'Shared editing saved')
  const activity=await viewer.getWork(task.id),listed=(await viewer.listWork({scope:'visible',q:'Shared activity'})).items.find(row=>row.id===task.id)
  assert.equal(activity.canEdit,true);assert.equal(listed.canEdit,true);assert.equal(listed.parent.id,enquiry.id)
  await setSharing('activities',task.id,true,[grant(recipient)])
  assert.equal((await viewer.listWork({scope:'visible',q:'Shared activity'})).items.find(row=>row.id===task.id).canEdit,false)
  await setSharing('enquiries',enquiry.id,true,[])
  await assert.rejects(viewer.getWork(task.id),status(404))
  await setSharing('activities',task.id,true,[])
 }finally{await root.businessTeamMember.deleteMany({where:{tenantId:tenant,teamId:team.id,userId:recipient.id}})}
})

test('sharing a child does not bypass a private source contact',async()=>{
 const source=await crm.createContact({name:'Private source customer'}),enquiry=await crm.createEnquiry({title:'Shared child of private customer',contactId:source.id,assignedUserId:owner.id})
 await setSharing('contacts',source.id,true,[])
 await setSharing('enquiries',enquiry.id,true,[grant(recipient,'EDIT')])
 await assert.rejects(viewer.getEnquiry(enquiry.id),status(404))
 assert.equal((await viewer.listEnquiries({q:enquiry.title})).total,0)
 await setSharing('contacts',source.id,true,[grant(recipient)])
 assert.equal((await viewer.getEnquiry(enquiry.id)).id,enquiry.id)
})

test('raw report predicates retain None and export bounds even when a private record is explicitly shared',async()=>{
 const {authorizeBusinessOperation}=require('../platform/access/operation.ts'),{ownedRecordSql}=require('../platform/access/record-scope.ts'),{Prisma}=require('@prisma/client')
 const enquiry=await crm.createEnquiry({title:'Report policy cap',contactId:contact.id,assignedUserId:owner.id})
 await setSharing('enquiries',enquiry.id,true,[grant(recipient,'EDIT')])
 const current=await roles.assignment(recipient.id)
 try{
  for(const deniedPermission of ['enquiries.read','enquiries.export']){
   const before=await roles.assignment(recipient.id)
   await roles.assign(recipient.id,{roleIds:[profile.id],version:before.accessPolicy.version,rules:{...current.accessPolicy.rules,[deniedPermission]:'NONE'}})
   const count=await db.$transaction(async tx=>{
    const actor=await authorizeBusinessOperation(tx,identity(recipient),'dashboard.read'),action=deniedPermission.endsWith('export')?'export':'read'
    const [row]=await tx.$queryRaw(Prisma.sql`SELECT count(*)::int n FROM "CrmEnquiry" e WHERE e."tenantId"=${tenant} AND e.id=${enquiry.id} AND ${ownedRecordSql(actor,'enquiries','e',action)}`)
    return row.n
   })
   assert.equal(count,0)
  }
 }finally{const denied=await roles.assignment(recipient.id);await roles.assign(recipient.id,{roleIds:[profile.id],version:denied.accessPolicy.version,rules:current.accessPolicy.rules})}
})

test('sharing validation, tenant boundaries, stale edits and audit failure cannot partially change access',async()=>{
 const before=await sharing.get('enquiries',lead.id)
 await assert.rejects(sharing.save('enquiries',lead.id,{version:before.version,restricted:true,grants:[grant(foreignAdmin)]}),status(400))
 await assert.rejects(createRecordSharingService(other,identity(foreignAdmin)).get('enquiries',lead.id),status(404))
 await assert.rejects(sharing.save('enquiries',lead.id,{version:0,restricted:false,grants:[]}),status(409))
 const trigger='reject_share_'+randomUUID().replaceAll('-','')
 await root.$executeRawUnsafe(`CREATE FUNCTION ${trigger}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event='access.recordSharing.updated' THEN RAISE EXCEPTION 'test sharing audit rollback'; END IF;RETURN NEW;END $$`)
 await root.$executeRawUnsafe(`CREATE TRIGGER ${trigger} BEFORE INSERT ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION ${trigger}()`)
 try{await assert.rejects(sharing.save('enquiries',lead.id,{version:before.version,restricted:false,grants:[grant(recipient)]}));assert.deepEqual(await sharing.get('enquiries',lead.id),before)}
 finally{await root.$executeRawUnsafe(`DROP TRIGGER ${trigger} ON "AuditLog"`);await root.$executeRawUnsafe(`DROP FUNCTION ${trigger}()`)}
})

test('quotation and order restrictions propagate through financial queries; read-only shares cannot collect payments',async()=>{
 const pipeline=await crm.createPipeline({name:'Sharing pipeline',stages:[{name:'Open',kind:'OPEN',probability:10,color:'#123456'},{name:'Won',kind:'WON',probability:100,color:'#00aa00'},{name:'Lost',kind:'LOST',probability:0,color:'#aa0000'}]})
 const source=await crm.createEnquiry({title:'Read-only conversion check',contactId:contact.id,assignedUserId:owner.id})
 await setSharing('enquiries',source.id,true,[grant(recipient)])
 const conversion={title:'Denied read-only conversion',contactId:contact.id,assignedUserId:recipient.id,enquiryId:source.id,pipelineId:pipeline.id,stageId:pipeline.stages[0].id,amount:'100',currency:'INR',expectedCloseOn:'2030-01-01'}
 await assert.rejects(viewer.createOpportunity(conversion),status(404))
 assert.equal(await root.crmOpportunity.count({where:{tenantId:tenant,enquiryId:source.id}}),0)
 const deal=await crm.createOpportunity({title:'Private contract',contactId:contact.id,assignedUserId:owner.id,pipelineId:pipeline.id,stageId:pipeline.stages[0].id,amount:'100',currency:'INR',expectedCloseOn:'2030-01-01'})
 const q=await crm.saveQuotation(deal.id,{content:{...structuredClone(emptyQuotationContent),title:'Private quotation',supplierName:'Example',currency:'INR',lines:[{description:'Support',quantity:'1',unit:'hour',rate:'100'}]}})
 const orders=applicationSalesOrders(db,identity(admin)),order=await orders.create({quotationId:q.id,revision:1});await orders.transition(order.id,{action:'confirm',version:1})
 const ledger=applicationReceivables(db,identity(admin));await ledger.open(order.id,{dueDates:(await ledger.get(order.id)).plan.lines.map(()=>null)})
 await setSharing('quotations',q.id,true,[grant(recipient)])
 assert.equal((await viewer.getQuotation(q.id,1,true)).id,q.id)
 assert.equal((await viewer.getQuotation(q.id)).recordAccess.permissions['quotations.edit'],false)
 await assert.rejects(managerCrm.getQuotation(q.id),status(404))
 await assert.rejects(applicationSalesOrders(db,identity(manager)).get(order.id),status(404))
 await assert.rejects(applicationReceivables(db,identity(manager)).get(order.id),status(404))
 assert.equal(await direct(manager,()=>db.crmQuotationRevision.count({where:{quotationId:q.id}})),0)
 await setSharing('quotations',q.id,false,[])
 await setSharing('salesOrders',order.id,true,[grant(recipient)])
 const received=applicationReceivables(db,identity(recipient)),view=await received.get(order.id)
 assert.equal((await received.list({})).total,1)
 assert.equal(view.canRecord,false);assert.equal(view.canReadPayments,true)
 await assert.rejects(received.record(order.id,{requestKey:randomUUID(),version:1,amount:'10',receivedOn:'2030-01-01',method:'CASH',reference:'',note:''}),status(404))
 await assert.rejects(applicationReceivables(db,identity(manager)).get(order.id),status(404))
 assert.equal((await applicationReceivables(db,identity(manager)).list({})).total,0)
 const current=await roles.assignment(recipient.id)
 await roles.assign(recipient.id,{roleIds:[profile.id],version:current.accessPolicy.version,rules:{...current.accessPolicy.rules,'salesOrders.read':'NONE'}})
 try{await assert.rejects(received.list({}),status(403))}
 finally{const denied=await roles.assignment(recipient.id);await roles.assign(recipient.id,{roleIds:[profile.id],version:denied.accessPolicy.version,rules:current.accessPolicy.rules})}
})

test('a private enquiry can be handed off without keeping access for its former owner',async()=>{
 const enquiry=await crm.createEnquiry({title:'Private owner handoff',contactId:contact.id,assignedUserId:owner.id})
 await setSharing('enquiries',enquiry.id,true,[])
 const current=await roles.assignment(owner.id)
 await roles.assign(owner.id,{roleIds:[profile.id],version:current.accessPolicy.version,rules:{...current.accessPolicy.rules,'enquiries.read':'ALL','enquiries.edit':'OWN','enquiries.assign':'OWN','assignmentTargets.read':'ALL'}})
 const changed=await staffCrm.updateEnquiry(enquiry.id,{title:enquiry.title,assignedUserId:recipient.id,status:'NEW',version:enquiry.version})
 assert.equal(changed.assignedUserId,recipient.id)
 await assert.rejects(staffCrm.getEnquiry(enquiry.id),status(404))
 assert.equal((await viewer.getEnquiry(enquiry.id)).id,enquiry.id)
 assert.ok(await root.auditLog.findFirst({where:{tenantId:tenant,entityId:enquiry.id,event:'crm.enquiry.updated'}}))
})

test('a hidden inherited activity blocks reassignment instead of silently changing restricted work',async()=>{
 const enquiry=await crm.createEnquiry({title:'Protected inherited work',contactId:contact.id,assignedUserId:owner.id})
 const task=await crm.createTask(enquiry.id,{title:'Private follow-up',dueOn:'2030-01-01'})
 await setSharing('activities',task.id,true,[grant(manager)])
 await root.crmTask.update({where:{tenantId_id:{tenantId:tenant,id:task.id}},data:{assignedUserId:recipient.id}})
 await assert.rejects(staffCrm.updateEnquiry(enquiry.id,{title:enquiry.title,assignedUserId:recipient.id,status:'NEW',version:enquiry.version}),status(403))
 assert.equal((await crm.getEnquiry(enquiry.id)).assignedUserId,owner.id)
 assert.equal((await root.crmTask.findUnique({where:{tenantId_id:{tenantId:tenant,id:task.id}}})).assignedUserId,recipient.id)
})

test('project restrictions and selected access are inherited by active subprojects',async()=>{
 const {createRealEstateService}=require('../modules/real-estate/service.ts'),projects=createRealEstateService(db,identity(admin))
 const parent=await projects.createProject({name:'Private project',code:'PRIVATE'}),child=await projects.createProject({name:'Private child',code:'PRIVATE_CHILD',parentId:parent.id})
 await setSharing('projects',parent.id,true,[grant(recipient)])
 const selected=createRealEstateService(db,identity(recipient)),wide=createRealEstateService(db,identity(manager))
 assert.equal((await selected.getProject(child.id)).id,child.id)
 assert.equal((await selected.getProject(parent.id)).canManage,false)
 await assert.rejects(wide.getProject(parent.id),status(404));await assert.rejects(wide.getProject(child.id),status(404))
 const inherited=await sharing.get('projects',child.id);assert.equal(inherited.recordId,parent.id);assert.equal(inherited.inherited,true)
})

test('private orders keep availability accurate, prevent double holds and reclaim expired holds without revealing the order',async()=>{
 const {applicationCatalog}=require('../application/catalog/service.ts'),{applicationReservations}=require('../application/catalog/reservations.ts')
 const catalog=applicationCatalog(db,identity(admin)),publicCatalog=applicationCatalog(db,identity(manager)),bookings=applicationReservations(db,identity(admin)),outsider=applicationReservations(db,identity(manager)),orders=applicationSalesOrders(db,identity(admin))
 const pipeline=await crm.createPipeline({name:'Availability pipeline',stages:[{name:'Open',kind:'OPEN',probability:10,color:'#123456'},{name:'Won',kind:'WON',probability:100,color:'#00aa00'},{name:'Lost',kind:'LOST',probability:0,color:'#aa0000'}]})
 const deal=await crm.createOpportunity({title:'Availability contract',contactId:contact.id,assignedUserId:owner.id,pipelineId:pipeline.id,stageId:pipeline.stages[0].id,amount:'100',currency:'INR',expectedCloseOn:'2030-01-01'})
 const createOrder=async item=>{const q=await crm.saveQuotation(deal.id,{content:{...structuredClone(emptyQuotationContent),title:'Unit contract',supplierName:'Example',currency:'INR',lines:[{description:item.name,quantity:'1',unit:item.unit,rate:String(item.price),catalogItemId:item.id,catalogItemVersion:item.version}]}});return orders.create({quotationId:q.id,revision:1})}
 const item=await catalog.save({name:'Shared availability',code:randomUUID(),kind:'UNIT',unit:'unit',price:'100',currency:'INR'}),one=await createOrder(item),two=await createOrder(item)
 const held=await bookings.create(one.id,{itemId:item.id,expiresAt:new Date(Date.now()+86400000).toISOString()})
 await setSharing('salesOrders',one.id,true,[])
 await assert.rejects(applicationSalesOrders(db,identity(manager)).get(one.id),status(404))
 assert.equal((await publicCatalog.get(item.id)).reservationState,'RESERVED')
 assert.equal((await publicCatalog.list({q:item.code,availability:'AVAILABLE'})).total,0)
 assert.equal((await publicCatalog.list({q:item.code,availability:'RESERVED'})).total,1)
 await assert.rejects(outsider.create(two.id,{itemId:item.id,expiresAt:new Date(Date.now()+86400000).toISOString()}),status(409))
 const facts=await direct(manager,()=>db.catalogReservationAvailability.findUnique({where:{tenantId_itemId:{tenantId:tenant,itemId:item.id}}}))
 assert.deepEqual(Object.keys(facts).sort(),['expiresAt','itemId','status','tenantId'])
 assert.equal((await direct(manager,()=>db.catalogReservationAvailability.updateMany({where:{tenantId:tenant,itemId:item.id},data:{status:'ALLOCATED'}}))).count,0)
 assert.equal((await root.unitReservation.findUnique({where:{tenantId_id:{tenantId:tenant,id:held.id}}})).status,'HELD')
 const shortItem=await catalog.save({name:'Expiry availability',code:randomUUID(),kind:'UNIT',unit:'unit',price:'100',currency:'INR'}),shortOne=await createOrder(shortItem),shortTwo=await createOrder(shortItem)
 const expiresAt=new Date(Date.now()+1500).toISOString(),expiring=await bookings.create(shortOne.id,{itemId:shortItem.id,expiresAt})
 await setSharing('salesOrders',shortOne.id,true,[])
 await new Promise(resolve=>setTimeout(resolve,Math.max(0,Date.parse(expiresAt)-Date.now()+25)))
 const replacement=await outsider.create(shortTwo.id,{itemId:shortItem.id,expiresAt:new Date(Date.now()+86400000).toISOString()})
 assert.equal(replacement.orderId,shortTwo.id)
 assert.equal((await root.unitReservation.findUnique({where:{tenantId_id:{tenantId:tenant,id:expiring.id}}})).status,'EXPIRED')
 assert.equal(await root.unitReservationEvent.count({where:{tenantId:tenant,reservationId:expiring.id,status:'EXPIRED'}}),1)
 assert.equal(await root.auditLog.count({where:{tenantId:tenant,entityId:expiring.id,event:'catalog.reservation.expired'}}),1)
})
