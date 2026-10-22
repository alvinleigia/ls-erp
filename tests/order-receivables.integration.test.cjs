/* eslint-disable @typescript-eslint/no-require-imports */
const {test,before,after}=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto'),{Pool}=require('pg'),{PrismaClient}=require('@prisma/client')
const {TenantPgAdapter}=require('../lib/tenant-pg-adapter.ts'),{createApplicationCrmService}=require('../application/crm/service.ts'),{applicationSalesOrders}=require('../application/sales-orders/service.ts'),{emptyQuotationContent}=require('../modules/sales-documents/quotation-validation.ts')
require('../lib/logger.ts').logger.info=()=>{}
const url=new URL(process.env.CRM_TEST_DATABASE_URL||'http://invalid')
if(!['localhost','127.0.0.1'].includes(url.hostname)||url.pathname!='/ls_salon_crm_test')throw Error('Use the isolated local test database.')
const tenant='orders_'+randomUUID(),otherTenant='orders_'+randomUUID(),pools=[],clients=[]
function client(tenantId,root=false){const u=new URL(url);if(!root){u.username='crm_test_runtime';u.password=''}const pool=new Pool({connectionString:u.toString(),max:6});pools.push(pool);const db=new PrismaClient({adapter:new TenantPgAdapter(pool,{tenantId,bypass:root})});clients.push(db);return db}
const root=client(undefined,true),db=client(tenant),dbB=client(otherTenant),unscoped=client(undefined)
const identity=user=>({tenantId:user.tenantId,userId:user.id}),status=code=>e=>e.status===code
let manager,staff,other,foreign,orders,crm,deal,contact
const content=(extra={})=>({...structuredClone(emptyQuotationContent),title:'Annual maintenance',supplierName:'Shared Industries',currency:'INR',lines:[{description:'Support hours',quantity:'3',unit:'hour',rate:'100.125'}],...extra})
const quote=()=>crm.saveQuotation(deal.id,{content:content()})
before(async()=>{
 await root.tenant.createMany({data:[{id:tenant,slug:tenant,name:'Generic orders'},{id:otherTenant,slug:otherTenant,name:'Other'}]})
 const user=(tenantId,role)=>root.user.create({data:{tenantId,role,name:role,email:randomUUID()+'@example.test'}})
 manager=await user(tenant,'MANAGER');staff=await user(tenant,'STAFF');other=await user(tenant,'STAFF');foreign=await user(otherTenant,'ADMIN')
 await root.tenantModule.createMany({data:[tenant,otherTenant].flatMap(tenantId=>['crm','salesDocuments','salesOrders','receivables','paymentPlans'].map(key=>({tenantId,key,allowed:true,enabled:true})))})
 orders=applicationSalesOrders(db,identity(manager));crm=createApplicationCrmService(db,identity(manager))
 contact=await root.crmContact.create({data:{tenantId:tenant,name:'Original customer',email:'original@example.test',ownerUserId:staff.id}})
 const pipeline=await root.crmPipeline.create({data:{tenantId:tenant,name:'Sales'}}),stage=await root.crmStage.create({data:{tenantId:tenant,pipelineId:pipeline.id,name:'Qualified',position:0,kind:'OPEN',probability:10,color:'#123456'}})
 deal=await crm.createOpportunity({title:'Service contract',contactId:contact.id,assignedUserId:staff.id,pipelineId:pipeline.id,stageId:stage.id,amount:'300.375',currency:'INR',expectedCloseOn:'2027-01-01'})
})
after(async()=>{await Promise.all(clients.map(c=>c.$disconnect()));await Promise.all(pools.map(p=>p.end()))})


const {applicationReceivables}=require('../application/receivables/service.ts')
const svc=()=>applicationReceivables(db,identity(manager))
async function fresh(extra={}){const q=await crm.saveQuotation(deal.id,{content:content(extra)});const o=await orders.create({quotationId:q.id,revision:1});await orders.transition(o.id,{action:'confirm',version:1});return o.id}
async function opened(extra={},dates){const id=await fresh(extra),plan=(await svc().get(id)).plan;await svc().open(id,{dueDates:dates||plan.lines.map(()=>null)});return id}
const pay=(extra={})=>({requestKey:randomUUID(),version:1,amount:'50.12',receivedOn:'2026-01-01',method:'BANK_TRANSFER',reference:randomUUID(),note:'',...extra})
const reverse=(extra={})=>({requestKey:randomUUID(),version:2,kind:'CORRECTION',reason:'Mistaken entry',effectiveOn:'2026-01-02',reference:'',...extra})

test('frozen instalments and extra charges reconcile; partial payments allocate due dates before unscheduled',async()=>{
 const id=await opened({instalments:[{label:'First',percent:'50',days:0,note:''},{label:'Final',percent:'50',days:10,note:''}],charges:[{label:'Delivery',kind:'FIXED',value:'20',basis:'BASE',included:false,due:'',group:''}]},[null,'2025-01-01','2025-02-01'])
 let state=await svc().get(id);assert.equal(String(state.account.total),'320.38');assert.equal(String(state.overdue),'170.19')
 const row=await svc().record(id,pay({amount:'160'}));state=await svc().get(id)
 assert.deepEqual(state.lines.map(l=>String(l.paid)),['0','150.19','9.81']);assert.equal(String(state.outstanding),'160.38');assert.equal(String(state.overdue),'10.19')
 assert.equal(row.status,'POSTED');assert.equal(state.account.version,2)
 await assert.rejects(svc().open(id,{dueDates:[null,null,null]}),status(409))
})
test('pending charges block opening; draft orders and malformed schedules are denied',async()=>{
 const id=await fresh({charges:[{label:'TBD',kind:'TBD',value:'0',basis:'BASE',included:false,due:'',group:''}]})
 assert((await svc().get(id)).plan.blocked);await assert.rejects(svc().open(id,{dueDates:[null]}),status(409))
 const q=await quote(),draft=await orders.create({quotationId:q.id,revision:1});await assert.rejects(svc().open(draft.id,{dueDates:[null]}),status(409))
 const confirmed=await fresh();await assert.rejects(svc().open(confirmed,{dueDates:[null,null]}),status(400))
})
test('duplicate requests are idempotent; altered payload, duplicate reference, precision and overpayment rejected',async()=>{
 const id=await opened(),input=pay(),rows=await Promise.all([svc().record(id,input),svc().record(id,input)])
 assert.equal(rows[0].id,rows[1].id);assert.equal(await root.orderReceipt.count({where:{tenantId:tenant,orderId:id}}),1)
 await assert.rejects(svc().record(id,{...input,amount:'1'}),status(409))
 for(const amount of ['0','0.001','999'])await assert.rejects(svc().record(id,pay({version:2,amount})),e=>[400,409].includes(e.status))
 await assert.rejects(svc().record(id,pay({version:2,receivedOn:'2099-01-01'})),status(400))
 const otherId=await opened();await assert.rejects(svc().record(otherId,pay({reference:input.reference.toUpperCase()})),status(409))
 await assert.rejects(svc().record(id,pay()),status(409))
})
test('corrections and full refunds retain immutable originals and resolve cancellation even with module disabled',async()=>{
 const id=await opened(),payment=await svc().record(id,pay()),rev=reverse()
 await root.tenantModule.update({where:{tenantId_key:{tenantId:tenant,key:'receivables'}},data:{enabled:false}})
 try{await assert.rejects(orders.transition(id,{action:'cancel',version:2,reason:'Test'}),status(409));await assert.rejects(svc().get(id),status(403))}finally{await root.tenantModule.update({where:{tenantId_key:{tenantId:tenant,key:'receivables'}},data:{enabled:true}})}
 const corrected=await svc().reverse(id,payment.id,rev);assert.deepEqual(await svc().reverse(id,payment.id,rev),corrected)
 const replacement=await svc().record(id,pay({version:3,reference:payment.reference}))
 await assert.rejects(svc().reverse(id,replacement.id,reverse({version:4,effectiveOn:'2025-12-31'})),status(400))
 await svc().reverse(id,replacement.id,reverse({version:4,kind:'REFUND',reference:'external-refund'}))
 const state=await svc().get(id);assert.equal(String(state.paid),'0');assert.equal(state.items.length,2);assert(state.items.every(p=>p.status==='REVERSED'&&p.reversal))
 await orders.transition(id,{action:'cancel',version:2,reason:'Refund complete'});assert.equal(String((await svc().get(id)).outstanding),'0')
 await assert.rejects(svc().record(id,pay({version:5})),status(409))
 await assert.rejects(root.orderReceipt.update({where:{tenantId_id:{tenantId:tenant,id:payment.id}},data:{amount:'1'}}))
 await assert.rejects(root.orderReceiptReversal.delete({where:{tenantId_paymentId:{tenantId:tenant,paymentId:payment.id}}}))
})
test('concurrent payments and cancellation cannot leave a paid cancelled order',async()=>{
 const id=await opened(),results=await Promise.allSettled([svc().record(id,pay()),orders.transition(id,{action:'cancel',version:2,reason:'Concurrent cancellation'})])
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1)
 const state=await svc().get(id);if(state.status==='CANCELLED')assert.equal(String(state.paid),'0');else assert.equal(state.status,'CONFIRMED')
 const second=await opened(),payments=await Promise.allSettled([svc().record(second,pay({amount:'200'})),svc().record(second,pay({amount:'200'}))]);assert.equal(payments.filter(r=>r.status==='fulfilled').length,1)
})
test('fresh role, user, scope, module dependency and forced RLS checks protect financial records',async()=>{
 const id=await opened();await svc().record(id,pay())
 await assert.rejects(applicationReceivables(dbB,identity(foreign)).get(id),status(404))
 await assert.rejects(applicationReceivables(db,identity(other)).get(id),status(404))
 await assert.rejects(applicationReceivables(db,identity(staff)).record(id,pay({version:2})),status(403))
 for(const model of ['orderReceivable','orderReceivableLine','orderReceipt','orderReceiptAllocation','orderReceiptReversal']){assert.equal((await unscoped[model].findMany()).length,0);assert.equal((await dbB[model].findMany({where:{tenantId:tenant}})).length,0)}
 const role=await root.tenantAccessRole.create({data:{tenantId:tenant,name:'Balance only',nameKey:randomUUID(),permissions:['salesOrders.read','receivables.read']}})
 await root.tenantRoleAssignment.create({data:{tenantId:tenant,userId:manager.id,roleId:role.id}})
 try{const view=await svc().get(id);assert.equal(view.canRecord,false);assert.equal(view.items.length,0);await assert.rejects(svc().record(id,pay({version:2})),status(403));await root.tenantAccessRole.update({where:{tenantId_id:{tenantId:tenant,id:role.id}},data:{crmRecordScope:'OWN'}});await assert.rejects(svc().get(id),status(404))}finally{await root.tenantRoleAssignment.deleteMany({where:{tenantId:tenant,userId:manager.id}})}
 await root.tenantModule.update({where:{tenantId_key:{tenantId:tenant,key:'salesOrders'}},data:{enabled:false}});try{await assert.rejects(svc().get(id),status(403))}finally{await root.tenantModule.update({where:{tenantId_key:{tenantId:tenant,key:'salesOrders'}},data:{enabled:true}})}
})
test('deferred database checks reject unreconciled receipts and cross-order allocations',async()=>{
 const id=await opened(),data={tenantId:tenant,orderId:id,requestKey:randomUUID(),amount:'10',receivedOn:new Date('2026-01-01'),method:'CASH',createdBy:manager.id,actorName:'Manager'}
 await assert.rejects(root.orderReceipt.create({data}));assert.equal(await root.orderReceipt.count({where:{tenantId:tenant,orderId:id}}),0)
 const otherId=await opened(),line=await root.orderReceivableLine.findFirst({where:{tenantId:tenant,orderId:otherId}})
 await assert.rejects(root.$transaction(async tx=>{const p=await tx.orderReceipt.create({data});await tx.orderReceiptAllocation.create({data:{tenantId:tenant,orderId:id,paymentId:p.id,lineId:line.id,amount:'10'}})}))
})
test('audit failure rolls back opening, payment and reversal with all balances intact',async()=>{
 const broken=new Proxy(db,{get(target,key){if(key==='$transaction')return (fn,options)=>target.$transaction(tx=>fn(new Proxy(tx,{get(t,k){if(k==='auditLog')return new Proxy(t.auditLog,{get(a,m){return m==='create'?async()=>{throw Error('Audit unavailable')}:a[m]}});return t[k]}})),options);return target[key]}}),service=applicationReceivables(broken,identity(manager))
 const id=await fresh();await assert.rejects(service.open(id,{dueDates:[null]}),/Audit unavailable/);assert.equal((await svc().get(id)).account,null)
 await svc().open(id,{dueDates:[null]});await assert.rejects(service.record(id,pay()),/Audit unavailable/);assert.equal(String((await svc().get(id)).paid),'0')
 const p=await svc().record(id,pay());await assert.rejects(service.reverse(id,p.id,reverse()),/Audit unavailable/);const view=await svc().get(id);assert.equal(view.items[0].status,'POSTED');assert.equal(view.account.version,2)
})
