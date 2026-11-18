/* eslint-disable @typescript-eslint/no-require-imports */
// Offline, pre-commercial project reassignment. Never imported by the app.
// Application access and immutable ownership guards are not relaxed at runtime.
const assert = require('node:assert/strict')
const { createHash, randomUUID } = require('node:crypto')
const qi = value => '"' + value.replaceAll('"', '""') + '"'
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const roots = ['RealEstateProject','CrmEnquiry','CrmOpportunity','CrmTask','CrmEnquiryImport']
const financial = ['CrmQuotation','SalesOrder','RealEstateUnit','CrmPlanLaunch']

async function plan(db, manifest, access = {}) {
  assert.equal(manifest.format, 1, 'Unsupported mapping format')
  assert.match(manifest.tenantSlug || '', /^[a-z0-9-]+$/)
  assert(Array.isArray(manifest.projects) && manifest.projects.length > 0 && manifest.projects.length <= 200)
  assert.equal(new Set(manifest.projects.map(p=>p.code)).size,manifest.projects.length,'Duplicate project mapping')
  const tenant = (await db.query('SELECT id FROM "Tenant" WHERE slug=$1',[manifest.tenantSlug])).rows
  assert.equal(tenant.length,1,'Tenant not found'); const t = tenant[0].id
  const data = {}, tables = [...roots,'BusinessCompany','BusinessOffice','BusinessOfficePolicy','BusinessOfficeGrant','BusinessCompanyGrant','RealEstateEnquiryContext','RealEstateOpportunityContext','RealEstateProjectMember','TenantAccessRole','TenantUserAccess','TenantRoleAssignment','BusinessTeamMember','CrmEnquiryImportRow']
  for (const table of tables) data[table]=(await db.query(`SELECT to_jsonb(r) row FROM ${qi(table)} r WHERE "tenantId"=$1 ORDER BY to_jsonb(r)::text COLLATE "C"`,[t])).rows.map(r=>r.row)
  for (const table of financial) assert.equal((await db.query(`SELECT count(*)::int n FROM ${qi(table)} WHERE "tenantId"=$1`,[t])).rows[0].n,0,'Commercial sources, units or plan launches require a separately reviewed migration')
  const users=(await db.query('SELECT id,role,status FROM "User" WHERE "tenantId"=$1 ORDER BY id',[t])).rows
  const admins=users.filter(u=>u.role==='ADMIN'&&u.status==='ACTIVE');assert.equal(admins.length,1,'Choose an explicit migration operator when several administrators exist')
  const admin=admins[0].id
  const target = new Map()
  assert.deepEqual(data.RealEstateProject.filter(p=>!p.parentId).map(p=>p.code).sort(),manifest.projects.map(p=>p.code).sort(),'Project inventory changed; review the complete mapping')
  for(const m of manifest.projects){
    const project=data.RealEstateProject.find(p=>p.code===m.code&&!p.parentId)
    const company=data.BusinessCompany.find(c=>c.code===m.companyCode&&!c.archived)
    assert(project&&company,'Mapped project/company is missing or archived')
    const office=data.BusinessOffice.find(o=>o.companyId===company.id&&o.code===m.officeCode&&!o.archived)
    assert(office,'Choose an active target office in the mapped company')
    target.set(project.id,office.id)
  }
  for(const p of data.RealEstateProject.filter(p=>p.parentId)){assert(target.has(p.parentId),'Unmapped phase parent');target.set(p.id,target.get(p.parentId))}
  const changes=[], destinations={RealEstateProject:target}, oldOffice=new Map()
  for(const table of roots)for(const r of data[table])oldOffice.set(table+':'+r.id,r.officeId)
  const contexts=(name,key)=>new Map(data[name].map(c=>[c[key],c]))
  const ec=contexts('RealEstateEnquiryContext','enquiryId'),oc=contexts('RealEstateOpportunityContext','opportunityId')
  for(const [table,ctx]of [['CrmEnquiry',ec],['CrmOpportunity',oc]])destinations[table]=new Map(data[table].map(r=>[r.id,ctx.get(r.id)?.projectId?target.get(ctx.get(r.id).projectId):r.officeId]))
  for(const o of data.CrmOpportunity)if(o.enquiryId)assert.equal(destinations.CrmOpportunity.get(o.id),destinations.CrmEnquiry.get(o.enquiryId),'Opportunity/enquiry target conflict')
  for(const [ctx,source,key]of [[ec,'CrmEnquiry','enquiryId'],[oc,'CrmOpportunity','opportunityId']])for(const c of ctx.values()){
    if(c.projectId)assert(target.has(c.projectId),'Unknown linked project')
    if(c.subprojectId)assert.equal(target.get(c.subprojectId),destinations[source].get(c[key]),'Phase/source target conflict')
  }
  destinations.CrmEnquiryImport=new Map()
  for(const i of data.CrmEnquiryImport){
    const linked=data.CrmEnquiry.filter(e=>e.importId===i.id), offices=[...new Set(linked.map(e=>destinations.CrmEnquiry.get(e.id)))]
    assert(offices.length<=1,'Import batch spans companies; preserve provenance and resolve it first')
    const office=offices[0]||i.officeId
    // Pending/correction rows still refer to the saved mapping. Do not silently
    // move an unfinished import whose eventual records have not been assessed.
    if(office!==i.officeId)assert(!data.CrmEnquiryImportRow.some(r=>r.importId===i.id&&!['IMPORTED','DUPLICATE','ERROR','SKIPPED'].includes(r.status)),'Unfinished import needs review')
    destinations.CrmEnquiryImport.set(i.id,office)
  }
  const tasks=new Map(data.CrmTask.map(r=>[r.id,r]));destinations.CrmTask=new Map()
  function taskOffice(id,seen=new Set()){
    if(destinations.CrmTask.has(id))return destinations.CrmTask.get(id)
    assert(!seen.has(id),'Activity follow-up cycle');seen.add(id)
    const r=tasks.get(id);assert(r,'Activity source missing')
    assert(!r.collectionOrderId&&!r.planLaunchId,'Activity has a commercial/plan source')
    const candidates=[]
    if(r.enquiryId){assert(destinations.CrmEnquiry.has(r.enquiryId));candidates.push(destinations.CrmEnquiry.get(r.enquiryId))}
    if(r.opportunityId){assert(destinations.CrmOpportunity.has(r.opportunityId));candidates.push(destinations.CrmOpportunity.get(r.opportunityId))}
    if(r.followUpOfId)candidates.push(taskOffice(r.followUpOfId,new Set(seen)))
    assert(new Set(candidates).size<=1,'Activity source target conflict')
    const office=candidates[0]||r.officeId;destinations.CrmTask.set(id,office);return office
  }
  for(const r of data.CrmTask)taskOffice(r.id)
  for(const table of roots)for(const r of data[table]){
    const officeId=destinations[table].get(r.id);assert(officeId,'Missing target office')
    if(officeId!==r.officeId)changes.push({table,id:r.id,from:r.officeId,to:officeId,version:r.version??null})
  }
  await db.query("SELECT set_config('app.tenant_id',$1,true),set_config('app.actor_id',$2,true)",[t,admin])
  const needs = new Map(), add=(userId,officeId)=>{if(userId&&users.some(u=>u.id===userId&&u.status==='ACTIVE'))needs.set(userId+':'+officeId,{userId,officeId})}
  const resource={RealEstateProject:'projects',CrmEnquiry:'enquiries',CrmOpportunity:'opportunities',CrmTask:'activities'}
  for(const change of changes){
    const row=data[change.table].find(r=>r.id===change.id);add(row.assignedUserId,change.to)
    if(change.table==='CrmEnquiryImport')add(row.createdByUserId,change.to)
    if(change.table==='RealEstateProject')for(const m of data.RealEstateProjectMember)if(m.projectId===(row.parentId||row.id))add(m.userId,change.to)
    for(const user of users)for(const [permission,ids]of Object.entries(access[user.id]||{}))if(permission.split('.')[0]===resource[change.table]&&Array.isArray(ids)&&ids.includes(change.id))add(user.id,change.to)
  }
  const grants=[]
  for(const g of needs.values())if(!(await db.query('SELECT app.business_office_access($1,$2,$3) allowed',[t,g.officeId,g.userId])).rows[0].allowed)grants.push(g)
  grants.sort((a,b)=>(a.userId+':'+a.officeId).localeCompare(b.userId+':'+b.officeId,'en'))
  const accessAssessed=users.filter(u=>u.status==='ACTIVE').every(u=>['enquiries','opportunities','projects','activities','contacts','accounts'].every(r=>Object.hasOwn(access[u.id]||{},r+'.read')))
  return {tenantId:t,admin,users,manifest,changes,grants,digest:hash({manifest,data,users,access}),summary:{accessAssessed,records:Object.fromEntries(roots.map(k=>[k,changes.filter(c=>c.table===k).length])),officeGrants:grants.length,usersNeedingGrants:new Set(grants.map(g=>g.userId)).size,unassignedProjectEnquiries:data.CrmEnquiry.filter(e=>!ec.get(e.id)?.projectId).length}}
}

async function captureAccess(db, tenantId, users, role='prisma_app') {
  assert(['prisma_app','crm_test_runtime'].includes(role))
  const { Pool }=require('pg'),{PrismaClient}=require('@prisma/client'),{TenantPgAdapter}=require('../lib/tenant-pg-adapter.ts')
  const {runWithDatabaseActor}=require('../lib/database-actor.ts'),{authorizeBusinessOperation}=require('../platform/access/operation.ts')
  const {enquiryScope,opportunityScope,contactScope,accountScope}=require('../modules/crm/policy.ts'),{projectScope}=require('../modules/real-estate/access.ts'),{workScope}=require('../modules/crm/work-scope.ts')
  const {allPermissions}=require('../platform/access/catalog.ts')
  const pool=new Pool({...db.connectionParameters,max:1}),client=new PrismaClient({adapter:new TenantPgAdapter(pool,{tenantId})}),out={}
  try{
    for(const user of users.filter(u=>u.status==='ACTIVE')){
      out[user.id]={}
      try{await runWithDatabaseActor(user.id,()=>client.$transaction(async tx=>{
        await tx.$executeRawUnsafe('SET LOCAL ROLE '+qi(role))
        await authorizeBusinessOperation(tx,{tenantId,userId:user.id},'auditLogs.read')
      }));out[user.id]['auditLogs.read']=true}catch(e){if(e.status===403)out[user.id]['auditLogs.read']=null;else throw e}
      for(const [resource,model,scope]of [['enquiries','crmEnquiry',enquiryScope],['opportunities','crmOpportunity',opportunityScope],['projects','realEstateProject',projectScope],['activities','crmTask',workScope],['contacts','crmContact',contactScope],['accounts','crmAccount',accountScope]]){
        for(const action of ['read','edit','assign','archive','export']){
          const permission=resource+'.'+action;if(!allPermissions.includes(permission))continue
          try{out[user.id][permission]=await runWithDatabaseActor(user.id,()=>client.$transaction(async tx=>{
            await tx.$executeRawUnsafe('SET LOCAL ROLE '+qi(role))
            const actor=await authorizeBusinessOperation(tx,{tenantId,userId:user.id},permission)
            return (await tx[model].findMany({where:scope(actor,action),select:{id:true},orderBy:{id:'asc'}})).map(r=>r.id)
          },{maxWait:20000,timeout:30000}))}catch(e){if(e.status===403)out[user.id][permission]=null;else throw e}
        }
      }
    }
  }finally{await client.$disconnect();await pool.end()}
  return out
}

async function fingerprints(db, changes = [], { grants = [], migration = null } = {}) {
  const out={}, tables=(await db.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).rows
  for(const {tablename:table}of tables){
    const ids=changes.filter(c=>c.table===table).map(c=>c.id),args=[],bind=value=>{args.push(value);return '$'+args.length}
    let row=ids.length?`CASE WHEN r.id=ANY(${bind(ids)}::text[]) THEN to_jsonb(r)-'officeId'-'version'-'updatedAt' ELSE to_jsonb(r) END`:'to_jsonb(r)',where='TRUE'
    if(table==='BusinessOfficePolicy'&&grants.length)row=`CASE WHEN r."userId"=ANY(${bind([...new Set(grants.map(g=>g.userId))])}::text[]) THEN to_jsonb(r)-'version'-'updatedAt' ELSE to_jsonb(r) END`
    if(table==='BusinessOfficeGrant'&&grants.length)where=`NOT EXISTS(SELECT 1 FROM jsonb_to_recordset(${bind(JSON.stringify(grants))}::jsonb) AS g("userId" text,"officeId" text) WHERE g."userId"=r."userId" AND g."officeId"=r."officeId")`
    if(table==='AuditLog'&&migration)where=`r."requestId" IS DISTINCT FROM ${bind(migration)}::text`
    out[table]=(await db.query(`SELECT count(*)::int count,md5(coalesce(string_agg(row::text,'' ORDER BY row::text COLLATE "C"),'')) digest FROM (SELECT ${row} row FROM ${qi(table)} r WHERE ${where}) s`,args)).rows[0]
  }
  return out
}

async function applyLocal(db, manifest, reviewed, access, { failBeforeCommit = false } = {}) {
  assert(['127.0.0.1','localhost'].includes(db.connectionParameters.host),'Rehearsal database only; production execution is not implemented')
  assert.match(db.connectionParameters.database,/^ls_erp_(?:company_)?rehearsal_[a-f0-9]{12}$/,'Dedicated rehearsal database required')
  await db.query('BEGIN ISOLATION LEVEL SERIALIZABLE')
  try{
    for(const table of [...roots,'BusinessOfficePolicy','BusinessOfficeGrant','BusinessCompanyGrant','User'])await db.query(`LOCK TABLE ${qi(table)} IN ACCESS EXCLUSIVE MODE NOWAIT`)
    const current=await plan(db,manifest,access);assert.equal(current.digest,reviewed.digest,'Source changed; generate and review a fresh plan')
    assert(current.summary.accessAssessed,'Capture every active user action scope before migration')
    assert.deepEqual(current.grants,reviewed.grants,'Access proposal changed')
    const migration=randomUUID(),normalization={grants:current.grants,migration},before=await fingerprints(db,current.changes,normalization),triggers=[]
    await db.query("SELECT set_config('app.rls_bypass','on',true)")
    // Transactional DDL under exclusive table locks. Only the native office
    // immutability trigger is suspended, on this isolated copy, and restored
    // before constraints/access/data comparisons. A failure rolls back the DDL.
    for(const table of [...new Set(current.changes.map(c=>c.table))]){
      const found=(await db.query(`SELECT tgname,tgenabled FROM pg_trigger WHERE tgrelid=to_regclass($1) AND tgfoid='app.native_office_owner()'::regprocedure AND NOT tgisinternal`,['public.'+qi(table)])).rows
      assert.equal(found.length,1,'Unexpected office trigger inventory');assert.equal(found[0].tgenabled,'O','Office guard already disabled')
      triggers.push({table,name:found[0].tgname});await db.query(`ALTER TABLE ${qi(table)} DISABLE TRIGGER ${qi(found[0].tgname)}`)
    }
    async function audit(entityType,entityId,before,after,event){await db.query(`INSERT INTO "AuditLog"(id,"tenantId",event,"entityType","entityId","actorUserId","actorRole","requestId",before,after) VALUES($1,$2,$3,$4,$5,$6,'ADMIN',$7,$8,$9)`,[randomUUID(),current.tenantId,event,entityType,entityId,current.admin,migration,before,after])}
    for(const g of current.grants){
      const inserted=await db.query(`INSERT INTO "BusinessOfficeGrant"("tenantId","userId","officeId") VALUES($1,$2,$3) ON CONFLICT DO NOTHING`,[current.tenantId,g.userId,g.officeId]);assert.equal(inserted.rowCount,1)
      assert.equal((await db.query(`UPDATE "BusinessOfficePolicy" SET version=version+1,"updatedAt"=now() WHERE "tenantId"=$1 AND "userId"=$2`,[current.tenantId,g.userId])).rowCount,1,'Missing membership policy')
      await audit('BusinessOfficePolicy',g.userId,null,{addedOfficeId:g.officeId},'structure.projectMigration.officeGranted')
    }
    for(const c of current.changes){
      const version=c.version===null?'':',version=version+1'
      assert.equal((await db.query(`UPDATE ${qi(c.table)} SET "officeId"=$1${version} WHERE "tenantId"=$2 AND id=$3 AND "officeId"=$4`,[c.to,current.tenantId,c.id,c.from])).rowCount,1)
      await audit(c.table,c.id,{officeId:c.from,version:c.version},{officeId:c.to,version:c.version===null?null:c.version+1},'structure.projectMigration.recordMoved')
    }
    await db.query('SET CONSTRAINTS ALL IMMEDIATE')
    const completed=await plan(db,manifest,access);assert.equal(completed.changes.length,0,'Source ownership did not converge');assert.equal(completed.grants.length,0,'Office eligibility did not converge')
    for(const trigger of triggers)await db.query(`ALTER TABLE ${qi(trigger.table)} ENABLE TRIGGER ${qi(trigger.name)}`)
    const after=await fingerprints(db,current.changes,normalization)
    assert.deepEqual(after,before,'Existing data or unrelated security/history changed')
    assert.equal((await db.query('SELECT count(*)::int n FROM "AuditLog" WHERE "tenantId"=$1 AND "requestId"=$2',[current.tenantId,migration])).rows[0].n,current.changes.length+current.grants.length)
    for(const g of current.grants)assert.equal((await db.query('SELECT count(*)::int n FROM "BusinessOfficeGrant" WHERE "tenantId"=$1 AND "userId"=$2 AND "officeId"=$3',[current.tenantId,g.userId,g.officeId])).rows[0].n,1)
    for(const g of current.grants)assert((await db.query('SELECT app.business_office_access($1,$2,$3) allowed',[current.tenantId,g.officeId,g.userId])).rows[0].allowed)
    if(failBeforeCommit)throw Error('Forced rehearsal rollback')
    await db.query('COMMIT')
    return {migration,changes:current.summary,unrelatedTablesPreserved:true,guardsRestored:true,productionWrites:false}
  }catch(e){await db.query('ROLLBACK');throw e}
}
module.exports={plan,captureAccess,fingerprints,applyLocal}
