/* eslint-disable @typescript-eslint/no-require-imports */
require('../register.cjs')
require('../../lib/logger.ts').logger.info=()=>{}
const assert=require('node:assert/strict'),fs=require('node:fs'),{Client,Pool}=require('pg'),{createHash,randomUUID}=require('node:crypto'),{PrismaClient}=require('@prisma/client'),{TenantPgAdapter}=require('../../lib/tenant-pg-adapter.ts'),{fixtureUser}=require('./access-fixtures.cjs')
async function historical(db,url){
 const pool=new Pool({connectionString:url}),root=new PrismaClient({adapter:new TenantPgAdapter(pool,{bypass:true})})
 try{
  const tenantId='p12_history_'+randomUUID();await root.tenant.create({data:{id:tenantId,slug:tenantId,name:'QA P12 historical invoice'}})
  const user=await fixtureUser(root,{data:{tenantId,role:'ADMIN',name:'QA prior issuer',email:randomUUID()+'@example.test'}})
  const company=await root.businessCompany.findFirst({where:{tenantId}})||await root.businessCompany.create({data:{tenantId,code:'QA-P12',name:'QA prior company'}})
  const office=await root.businessOffice.findFirst({where:{tenantId,companyId:company.id}})||await root.businessOffice.create({data:{tenantId,companyId:company.id,code:'QA-P12',name:'QA prior office'}})
  await root.businessOfficePolicy.upsert({where:{tenantId_userId:{tenantId,userId:user.id}},create:{tenantId,userId:user.id,creationOfficeId:office.id},update:{}})
  await root.tenantModule.createMany({data:['crm','salesDocuments','salesOrders','receivables','paymentPlans','invoicing'].map(key=>({tenantId,key,allowed:true,enabled:true}))})
  const identity={tenantId,userId:user.id},crm=require('../../application/crm/service.ts').createApplicationCrmService(root,identity),orders=require('../../application/sales-orders/service.ts').applicationSalesOrders(root,identity),finance=require('../../application/receivables/service.ts').applicationReceivables(root,identity)
  const c=await root.crmContact.create({data:{tenantId,name:'QA historical customer',ownerUserId:user.id}}),p=await root.crmPipeline.create({data:{tenantId,name:'QA prior sales'}}),stage=await root.crmStage.create({data:{tenantId,pipelineId:p.id,name:'Open',kind:'OPEN',probability:10,color:'#123456',position:0}})
  const deal=await crm.createOpportunity({title:'QA pre-P12 accepted sale',contactId:c.id,assignedUserId:user.id,pipelineId:p.id,stageId:stage.id,amount:'100',currency:'INR',expectedCloseOn:'2027-01-01'}),quote=await crm.saveQuotation(deal.id,{content:{...structuredClone(require('../../modules/sales-documents/quotation-validation.ts').emptyQuotationContent),supplierName:'QA Shared Industries',currency:'INR',lines:[{description:'Accepted before upgrade',quantity:'3',unit:'each',rate:'33.3333'}]}}),order=await orders.create({quotationId:quote.id,revision:1,orderedOn:'2026-01-01'});await orders.transition(order.id,{action:'confirm',version:1});await finance.open(order.id,{dueDates:[null]});const saved=await orders.get(order.id),id=randomUUID()
  await db.query('BEGIN');try{
   await db.query("SELECT set_config('app.rls_bypass','on',true)")
   const meta=(await db.query('SELECT * FROM app.document_source_issuer($1,$2)',[tenantId,order.id])).rows[0],snapshot={kind:'COMMERCIAL',order:saved.snapshot,orderReference:saved.reference,sourceVersion:saved.version,currency:saved.currency,total:saved.snapshot.calculation.totalKnown,...meta}
   await db.query('INSERT INTO "CustomerInvoice"("tenantId",id,"orderId","requestKey","invoiceDate",snapshot,"createdBy","actorName") VALUES($1,$2,$3,$4,\'2026-01-01\',$5::jsonb,$6,\'QA prior issuer\')',[tenantId,id,order.id,randomUUID(),JSON.stringify(snapshot),user.id])
   await db.query('INSERT INTO "CustomerInvoiceEvent"("tenantId","invoiceId",version,status,"actorId","actorName","requestKey","requestHash") VALUES($1,$2,1,\'DRAFT\',$3,\'QA prior issuer\',$4,$5)',[tenantId,id,user.id,randomUUID(),'a'.repeat(64)])
   await db.query('UPDATE "CustomerInvoice" SET status=\'POSTED\',version=2 WHERE "tenantId"=$1 AND id=$2',[tenantId,id])
   await db.query('INSERT INTO "CustomerInvoiceEvent"("tenantId","invoiceId",version,status,"actorId","actorName","requestKey","requestHash") VALUES($1,$2,2,\'POSTED\',$3,\'QA prior issuer\',$4,$5)',[tenantId,id,user.id,randomUUID(),'b'.repeat(64)])
   await db.query('COMMIT')
  }catch(e){await db.query('ROLLBACK');throw e}
  return {tenantId,orderId:order.id,id}
 }finally{await root.$disconnect();await pool.end()}
}
async function main(){
 assert.equal(process.env.R5_HISTORICAL_CONTAINER,'1');const url=new URL(process.env.CRM_TEST_DATABASE_URL);assert.equal(url.hostname,'127.0.0.1');assert.equal(url.pathname,'/ls_salon_crm_test');const db=new Client({connectionString:url.toString()});await db.connect()
 try{
  const priorInvoice=await historical(db,url.toString()),tables=(await db.query("SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename<>'_prisma_migrations' ORDER BY tablename")).rows.map(r=>r.tablename)
  const snapshot=()=>Promise.all(tables.map(async t=>(await db.query(`SELECT ${t==='CustomerInvoice'?"to_jsonb(t)-'billing'":'to_jsonb(t)'} row FROM "${t}" t ORDER BY to_jsonb(t)::text COLLATE "C"`)).rows.map(r=>r.row)))
  const before=await snapshot(),policies=(await db.query("SELECT * FROM pg_policies WHERE schemaname='public' ORDER BY tablename,policyname")).rows,functions=(await db.query("SELECT p.oid,p.proname,pg_get_functiondef(p.oid) body FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='app'")).rows,name='20261030000300_partial_billing',sql=fs.readFileSync(`prisma/migrations/${name}/migration.sql`,'utf8')
  await assert.rejects(db.query(sql.replace(/COMMIT;\s*$/,'SELECT 1/0; COMMIT;')),/division by zero/);await db.query('ROLLBACK');assert.deepEqual(await snapshot(),before);assert.equal((await db.query("SELECT count(*)::int n FROM information_schema.columns WHERE table_name='CustomerInvoice' AND column_name='billing'")).rows[0].n,0)
  await db.query(sql);assert.deepEqual(await snapshot(),before);assert.deepEqual((await db.query("SELECT * FROM pg_policies WHERE schemaname='public' ORDER BY tablename,policyname")).rows,policies)
  const changed=['commercial_invoice_write','commercial_credit_write','invoice_application_write','invoice_document_chain'];for(const f of functions)if(!changed.includes(f.proname))assert.equal((await db.query('SELECT pg_get_functiondef($1::oid) body',[f.oid])).rows[0].body,f.body)
  const i=(await db.query('SELECT * FROM "CustomerInvoice" WHERE "tenantId"=$1 AND id=$2',[priorInvoice.tenantId,priorInvoice.id])).rows[0];assert.equal(i.billing.amount,i.snapshot.total);assert.equal(i.billing.request.mode,'FULL');assert.equal(i.billing.allocations[0].quantity,'3');assert.equal(i.reference,'INV/000001');assert.equal(i.version,2)
  await db.query('INSERT INTO "_prisma_migrations"(id,checksum,migration_name,finished_at) VALUES($1,$2,$1,now())',[name,createHash('sha256').update(sql).digest('hex')]);console.log(`Partial billing migration: forced rollback and ${tables.length} prior tables/policies preserved; prior invoice columns, numbering and events unchanged; historical full allocation verified; only four reviewed guards replaced; 139 migrations.`)
 }finally{await db.end()}
}
main().catch(e=>{console.error(e);process.exitCode=1})
