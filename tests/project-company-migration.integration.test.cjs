/* eslint-disable @typescript-eslint/no-require-imports */
const {test,before,after}=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto'),{Client,Pool}=require('pg'),{PrismaClient}=require('@prisma/client')
const {plan,captureAccess,applyLocal,applyProduction,fingerprints}=require('../scripts/project-company-migration.cjs')
const {TenantPgAdapter}=require('../lib/tenant-pg-adapter.ts'),{createApplicationCrmService}=require('../application/crm/service.ts'),{createRealEstateService}=require('../modules/real-estate/service.ts'),{createCompanyService}=require('../platform/companies/service.ts'),{createOfficeAccessService}=require('../platform/companies/office-access.ts'),{createAccessRoleService}=require('../platform/access/service.ts'),{allPermissions}=require('../platform/access/catalog.ts'),{defaultRecordRules,supportedScopes}=require('../platform/access/rules.ts')
require('../lib/logger.ts').logger.info=()=>{}
assert.equal(process.env.COMPANY_MIGRATION_TEST_RUN,'1');const url=new URL(process.env.COMPANY_MIGRATION_TEST_DATABASE_URL);assert.equal(url.hostname,'127.0.0.1');assert.match(url.pathname,/^\/ls_erp_company_rehearsal_[a-f0-9]{12}$/)
const db=new Client({connectionString:url.toString()}),pools=[],clients=[]
const tenant='company-'+randomUUID().replaceAll('-',''),foreign=tenant+'_foreign'
let admin,staff,manager,otherStaff,a,b,c,project,phase,kept,lead,opportunity,activity,manifest,baseline,reviewed
function client(t,bypass=false){const u=new URL(url);if(!bypass)u.username='crm_test_runtime';const pool=new Pool({connectionString:u.toString(),max:2});pools.push(pool);const c=new PrismaClient({adapter:new TenantPgAdapter(pool,{tenantId:t,bypass})});clients.push(c);return c}
let root,runtime,crm,projects,companies,officeAccess
before(async()=>{
 await db.connect();root=client(undefined,true);runtime=client(tenant)
 await root.tenant.createMany({data:[tenant,foreign].map(id=>({id,slug:id,name:id}))})
 const user=(role,t=tenant)=>root.user.create({data:{tenantId:t,role,email:randomUUID()+'@example.test',name:'Synthetic '+role}})
 admin=await user('ADMIN');staff=await user('STAFF');manager=await user('MANAGER');otherStaff=await user('STAFF',foreign)
 await root.tenantModule.createMany({data:['crm','realEstate','salesDocuments','salesOrders','receivables','catalog'].map(key=>({tenantId:tenant,key,allowed:true,enabled:true}))})
 const identity={tenantId:tenant,userId:admin.id};companies=createCompanyService(runtime,identity);officeAccess=createOfficeAccessService(runtime,identity);projects=createRealEstateService(runtime,identity);crm=createApplicationCrmService(runtime,identity)
 c=await companies.createCompany({name:'Separate legal entity',code:'TARGET'});a=(await companies.listOffices({})).items[0];b=await companies.createOffice({companyId:c.id,name:'Target main office',code:'TARGET'})
 for(const u of [admin,staff,manager]){const p=await officeAccess.getMemberships(u.id);await officeAccess.saveMemberships(u.id,{version:p.version,officeIds:[a.id],companies:[],creationOfficeId:a.id})}
 const roles=createAccessRoleService(runtime,identity),role=await roles.save({name:'Synthetic ownership checks',permissions:allPermissions}),rules=defaultRecordRules()
 for(const permission of Object.keys(rules))if(supportedScopes(permission.split('.')[0]).includes('ALL'))rules[permission]='ALL'
 for(const u of [staff,manager]){
   const ownRules={...rules}
   if(u.id===staff.id)for(const permission of Object.keys(ownRules)){
     if(['enquiries','opportunities','activities'].includes(permission.split('.')[0]))ownRules[permission]='OWN'
     if(permission.startsWith('projects.')||permission.startsWith('projectMembers.'))ownRules[permission]='ASSIGNED'
   }
   const p=await roles.assignment(u.id);await roles.assign(u.id,{roleIds:[role.id],rules:ownRules,version:p.accessPolicy.version})
 }
 project=await projects.createProject({name:'Move project',code:'MOVE'});phase=await projects.createProject({name:'Move phase',code:'PHASE',parentId:project.id});kept=await projects.createProject({name:'Keep project',code:'KEEP'})
 await projects.changeMember(project.id,{version:project.version,userId:staff.id})
 const privateProject=await root.recordSharingPolicy.create({data:{tenantId:tenant,resource:'projects',recordId:project.id,restricted:true}})
 await root.realEstateProject.update({where:{id:project.id},data:{sharingPolicyId:privateProject.id}})
 await root.recordSharingGrant.create({data:{tenantId:tenant,policyId:privateProject.id,userId:staff.id,level:'READ'}})
 const contact=await crm.createContact({name:'Synthetic shared customer',email:'customer-'+tenant+'@example.test'})
 lead=await crm.createEnquiry({title:'Move lead',contactId:contact.id,assignedUserId:staff.id,propertyContext:{projectId:project.id,subprojectId:phase.id}})
 const pipeline=await crm.createPipeline({name:'Company checks',stages:[{name:'Open',kind:'OPEN',probability:10,color:'#123456'},{name:'Won',kind:'WON',probability:100,color:'#00aa00'},{name:'Lost',kind:'LOST',probability:0,color:'#aa0000'}]})
 opportunity=await crm.createOpportunity({title:'Move deal',contactId:contact.id,enquiryId:lead.id,assignedUserId:staff.id,pipelineId:pipeline.id,stageId:pipeline.stages[0].id,amount:'100',currency:'INR',expectedCloseOn:'2030-01-01'})
 await crm.createEnquiry({title:'Unallocated lead',contactId:contact.id,assignedUserId:staff.id})
 // Use the saved source and original timestamps. Runtime create/read/edit paths
 // are independently covered by the native office suite.
 activity=await root.crmTask.create({data:{tenantId:tenant,officeId:a.id,title:'Move activity',dueOn:new Date('2030-01-01'),contactId:contact.id,enquiryId:lead.id,assignedUserId:staff.id,createdByUserId:admin.id}})
 manifest={format:1,tenantSlug:tenant,projects:[{code:'MOVE',companyCode:'TARGET',officeCode:'TARGET'},{code:'KEEP',companyCode:'MAIN',officeCode:'MAIN'}]}
 baseline=await captureAccess(db,tenant,[admin,staff,manager],'crm_test_runtime')
 await db.query('BEGIN READ ONLY');try{reviewed=await plan(db,manifest,baseline)}finally{await db.query('ROLLBACK')}
})
after(async()=>{await Promise.all(clients.map(c=>c.$disconnect()));await Promise.all(pools.map(p=>p.end()));await db.end()})

test('preview follows sources and adds only necessary office eligibility',()=>{
 assert.equal(reviewed.summary.records.RealEstateProject,2);assert.equal(reviewed.summary.records.CrmEnquiry,1);assert.equal(reviewed.summary.records.CrmOpportunity,1);assert.equal(reviewed.summary.records.CrmTask,1)
 assert.equal(reviewed.summary.unassignedProjectEnquiries,1);assert.equal(reviewed.summary.usersNeedingGrants,1)
 assert.deepEqual(reviewed.grants.map(g=>g.userId),[staff.id])
 assert(reviewed.grants.every(g=>g.officeId===b.id));assert(!reviewed.grants.some(g=>g.userId===otherStaff.id))
})
test('hosted databases and ordinary local demo are not valid migration targets',async()=>{
 await assert.rejects(applyLocal({connectionParameters:{host:'example.supabase.co',database:'postgres'}},manifest,reviewed,baseline),/Rehearsal database only/)
 await assert.rejects(applyLocal({connectionParameters:{host:'127.0.0.1',database:'ls_salon_crm_test'}},manifest,reviewed,baseline),/Dedicated rehearsal/)
})
test('production entry point requires exact environment, TLS, reviewed proof and drained maintenance',async()=>{
 const confirmation={tenantId:reviewed.tenantId,digest:reviewed.digest,verifiedBackup:'012345abcdef',copyRehearsalPassed:true}
 const connectionParameters={host:'aws-1-ap-south-1.pooler.supabase.com',port:5432,database:'postgres',user:'postgres.tehtbbifiimoplzlewzs',ssl:{rejectUnauthorized:true}}
 let writes=0
 const fake={connectionParameters,query:async sql=>{assert(sql.startsWith('SELECT'));writes++;return {rows:[{rolcanlogin:true,rolconnlimit:-1}]}}}
 await assert.rejects(applyProduction(db,manifest,reviewed,baseline,confirmation),/Database URL/)
 await assert.rejects(applyProduction({...fake,connectionParameters:{...connectionParameters,ssl:{rejectUnauthorized:false}}},manifest,reviewed,baseline,confirmation),/TLS/)
 await assert.rejects(applyProduction(fake,manifest,reviewed,baseline,{...confirmation,digest:'stale'}),/digest/)
 await assert.rejects(applyProduction(fake,manifest,reviewed,baseline,{...confirmation,copyRehearsalPassed:false}),/rehearsal/)
 await assert.rejects(applyProduction(fake,manifest,reviewed,baseline,confirmation),/Block runtime/)
 assert.equal(writes,1,'All invalid requests must stop before any database mutation')
 await assert.rejects(applyProduction({...fake,query:async sql=>({rows:sql.includes('pg_roles')?[{rolcanlogin:false,rolconnlimit:0}]:[{n:1}]})},manifest,reviewed,baseline,confirmation),/Drain runtime/)
})
test('conflicting mappings and post-preview changes fail before modifying rows',async()=>{
 const before=await fingerprints(db)
 await db.query('BEGIN READ ONLY');try{await assert.rejects(plan(db,{...manifest,projects:[manifest.projects[0]]},baseline),/Project inventory changed/)}finally{await db.query('ROLLBACK')}
 await assert.rejects(applyLocal(db,manifest,{...reviewed,digest:'stale'},baseline),/Source changed/)
 assert.deepEqual(await fingerprints(db),before)
})
test('incomplete access review and mixed-company import provenance block migration',async()=>{
 const before=await fingerprints(db)
 await db.query('BEGIN READ ONLY');let incomplete;try{incomplete=await plan(db,manifest)}finally{await db.query('ROLLBACK')}
 await assert.rejects(applyLocal(db,manifest,incomplete,{}),/Capture every active user/)
 await db.query('BEGIN')
 try{
   const batch=randomUUID()
   await db.query(`INSERT INTO "CrmEnquiryImport"(id,"tenantId","officeId","createdByUserId","fileName",headers,"updatedAt") VALUES($1,$2,$3,$4,'synthetic.csv','[]',now())`,[batch,tenant,a.id,admin.id])
   for(const p of [project,kept]){
     const id=randomUUID()
     await db.query(`INSERT INTO "CrmEnquiry" SELECT (jsonb_populate_record(NULL::"CrmEnquiry",to_jsonb(e)||jsonb_build_object('id',$2::text,'importId',$3::text))).* FROM "CrmEnquiry" e WHERE id=$1`,[lead.id,id,batch])
     await db.query(`INSERT INTO "RealEstateEnquiryContext"("tenantId","enquiryId","projectId") VALUES($1,$2,$3)`,[tenant,id,p.id])
   }
   await assert.rejects(plan(db,manifest,baseline),/Import batch spans companies/)
 }finally{await db.query('ROLLBACK')}
 assert.deepEqual(await fingerprints(db),before)
})
test('forced failure rolls back grants, data, audits and disabled trigger DDL',async()=>{
 const before=await fingerprints(db),guards=(await db.query(`SELECT tgrelid,tgname,tgenabled FROM pg_trigger WHERE tgfoid='app.native_office_owner()'::regprocedure ORDER BY tgrelid,tgname`)).rows
 await assert.rejects(applyLocal(db,manifest,reviewed,baseline,{failBeforeCommit:true}),/Forced rehearsal rollback/)
 assert.deepEqual(await fingerprints(db),before)
 assert.deepEqual((await db.query(`SELECT tgrelid,tgname,tgenabled FROM pg_trigger WHERE tgfoid='app.native_office_owner()'::regprocedure ORDER BY tgrelid,tgname`)).rows,guards)
})
test('successful move preserves every scoped action population and shared customer',async()=>{
 const result=await applyLocal(db,manifest,reviewed,baseline);assert(result.unrelatedTablesPreserved&&result.guardsRestored)
 assert.deepEqual(await captureAccess(db,tenant,[admin,staff,manager],'crm_test_runtime'),baseline)
 assert.equal((await projects.getProject(project.id)).office.companyName,c.name)
 assert.equal((await projects.getProject(kept.id)).office.id,a.id)
 assert.equal((await crm.getEnquiry(lead.id)).office.id,b.id)
 assert.equal((await crm.getOpportunity(opportunity.id)).office.id,b.id)
 assert.equal((await root.crmTask.findUnique({where:{id:activity.id}})).officeId,b.id)
 assert.equal(await root.crmContact.count({where:{tenantId:tenant}}),1)
 assert.equal((await root.crmEnquiry.findFirst({where:{tenantId:tenant,title:'Unallocated lead'}})).officeId,a.id)
 assert(!baseline[manager.id]['projects.read'].includes(project.id),'Restricted project leaked before move')
 await assert.rejects(root.realEstateProject.update({where:{id:project.id},data:{officeId:a.id}}),/immutable/)
 await db.query('BEGIN READ ONLY');try{const fresh=await plan(db,manifest,baseline);assert.equal(fresh.changes.length,0);assert.equal(fresh.grants.length,0)}finally{await db.query('ROLLBACK')}
})

test('commercial documents block reassignment rather than rewriting issued ownership',async()=>{
 const {emptyQuotationContent}=require('../modules/sales-documents/quotation-validation.ts')
 await crm.saveQuotation(opportunity.id,{content:{...structuredClone(emptyQuotationContent),title:'Synthetic commercial blocker',supplierName:'Test company',currency:'INR',lines:[{description:'Test',quantity:'1',unit:'service',rate:'100'}]}})
 const before=await fingerprints(db)
 await db.query('BEGIN READ ONLY');try{await assert.rejects(plan(db,manifest,baseline),/Commercial sources/)}finally{await db.query('ROLLBACK')}
 assert.deepEqual(await fingerprints(db),before)
})
