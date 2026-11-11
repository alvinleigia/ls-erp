/* eslint-disable @typescript-eslint/no-require-imports */
const assert=require('node:assert/strict'),fs=require('node:fs'),{Client}=require('pg'),{createHash,randomUUID}=require('node:crypto')
async function main(){
 assert.equal(process.env.R5_HISTORICAL_CONTAINER,'1');const url=new URL(process.env.CRM_TEST_DATABASE_URL);assert.equal(url.hostname,'127.0.0.1');assert.equal(url.pathname,'/ls_salon_crm_test')
 const db=new Client({connectionString:url.toString()});await db.connect()
 try{
  // Preserve actual pre-cutover attribution, not just empty new-feature columns.
  const sample=(await db.query('SELECT e.*,u.id AS actor FROM "CrmEnquiry" e JOIN "User" u ON u."tenantId"=e."tenantId" AND u.role=\'ADMIN\' AND u.status=\'ACTIVE\' AND u."collaboratorId" IS NULL WHERE EXISTS(SELECT 1 FROM "CrmOpportunity" o WHERE o."tenantId"=e."tenantId") ORDER BY e.id LIMIT 1')).rows[0]
  assert(sample,'Historical enquiry fixture required')
  const partner='prior_cp_'+randomUUID(),enquiry='prior_cp_enquiry_'+randomUUID(),opportunity='prior_cp_sale_'+randomUUID()
  await db.query('BEGIN');await db.query("SELECT set_config('app.rls_bypass','on',true),set_config('app.actor_id',$1,true)",[sample.actor])
  await db.query('INSERT INTO "ExternalCollaborator"(id,"tenantId",code,name,"supervisorUserId","updatedAt") VALUES($1,$2,\'PRIOR_CP\',\'Prior partner evidence\',$3,now())',[partner,sample.tenantId,sample.actor])
  await db.query('INSERT INTO "CrmEnquiry"(id,"tenantId","contactId",title,"assignedUserId","officeId",version,"updatedAt","introducedByCollaboratorId") VALUES($1,$2,$3,\'Historical CP selection\',$4,$5,4,now(),$6)',[enquiry,sample.tenantId,sample.contactId,sample.assignedUserId,sample.officeId,partner])
  await db.query('INSERT INTO "CrmOpportunity"(id,"tenantId",title,"pipelineId","stageId","contactId","assignedUserId",amount,currency,probability,"expectedCloseOn","officeId","enquiryId","updatedAt") SELECT $1,o."tenantId",\'Historical converted CP\',o."pipelineId",o."stageId",$3,o."assignedUserId",o.amount,o.currency,o.probability,o."expectedCloseOn",o."officeId",$2,now() FROM "CrmOpportunity" o WHERE o."tenantId"=$4 LIMIT 1',[opportunity,enquiry,sample.contactId,sample.tenantId])
  await db.query('COMMIT')
  const accepted=(await db.query('SELECT "introducedByCollaboratorId","partnerAttribution" FROM "CrmEnquiry" WHERE id=$1',[enquiry])).rows[0]
  assert.equal(accepted.introducedByCollaboratorId,partner);assert.equal(accepted.partnerAttribution.name,'Prior partner evidence')
  const tables=(await db.query("SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename<>'_prisma_migrations' ORDER BY tablename")).rows.map(r=>r.tablename)
  const snapshot=()=>Promise.all(tables.map(async table=>(await db.query(`SELECT md5(coalesce(string_agg(to_jsonb(t)::text,'|' ORDER BY to_jsonb(t)::text COLLATE "C"),'')) hash,count(*)::int count FROM "${table}" t`)).rows[0]))
  const before=await snapshot(),name='20261110000100_delegated_partner_links',sql=fs.readFileSync(`prisma/migrations/${name}/migration.sql`,'utf8')
  await assert.rejects(db.query(sql.replace(/COMMIT;\s*$/,'SELECT 1/0; COMMIT;')),/division by zero/);await db.query('ROLLBACK');assert.deepEqual(await snapshot(),before)
  assert.equal((await db.query("SELECT to_regclass('public.\"CrmPartnerLinkEvent\"') relation")).rows[0].relation,null)
  await db.query(sql);assert.deepEqual(await snapshot(),before)
  await db.query('GRANT SELECT,INSERT,UPDATE,DELETE ON "CrmPartnerLinkEvent" TO crm_test_runtime')
  assert.equal((await db.query('SELECT count(*)::int n FROM "CrmPartnerLinkEvent"')).rows[0].n,0)
  assert.deepEqual((await db.query('SELECT "introducedByCollaboratorId","partnerAttribution" FROM "CrmEnquiry" WHERE id=$1',[enquiry])).rows[0],accepted)
  await db.query('INSERT INTO "_prisma_migrations"(id,checksum,migration_name,finished_at) VALUES($1,$2,$1,now())',[name,createHash('sha256').update(sql).digest('hex')])
  console.log(`Delegated partner migration: forced rollback and exact preservation of ${tables.length} existing tables passed; no profile, scope or attribution backfill.`)
 }finally{await db.end()}
}
main().catch(e=>{console.error(e);process.exitCode=1})
