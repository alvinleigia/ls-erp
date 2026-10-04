/* eslint-disable @typescript-eslint/no-require-imports */
const {test}=require('node:test'),assert=require('node:assert/strict'),{Client}=require('pg'),{randomUUID}=require('node:crypto'),fs=require('node:fs')
test('audit indexes migrate existing rows without changing payloads or RLS',async()=>{
 const url=new URL(process.env.CRM_TEST_DATABASE_URL||'http://invalid')
 if(!['localhost','127.0.0.1'].includes(url.hostname)||url.pathname!='/ls_salon_crm_test')throw Error('Disposable local database only.')
 const db=new Client({connectionString:url.toString()});await db.connect()
 try {
  await db.query('BEGIN');const schema='audit_'+randomUUID().replaceAll('-','')
  await db.query(`CREATE SCHEMA ${schema}; SET LOCAL search_path TO ${schema}; CREATE TABLE "AuditLog" (id text PRIMARY KEY,"tenantId" text,"actorUserId" text,"entityType" text,"entityId" text,"createdAt" timestamp,before jsonb,after jsonb); ALTER TABLE "AuditLog" ENABLE ROW LEVEL SECURITY; ALTER TABLE "AuditLog" FORCE ROW LEVEL SECURITY;
  INSERT INTO "AuditLog" VALUES ('one','tenant','actor','Record','target',now(),'{"status":"DRAFT"}','{"status":"OPEN"}');`)
  const before=(await db.query('SELECT * FROM "AuditLog"')).rows
  await db.query(fs.readFileSync('prisma/migrations/20261004120000_audit_review_indexes/migration.sql','utf8'))
  assert.deepEqual((await db.query('SELECT * FROM "AuditLog"')).rows,before)
  assert.equal((await db.query('SELECT * FROM pg_indexes WHERE schemaname=$1',[schema])).rowCount,4)
  const security=(await db.query(`SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE oid='"AuditLog"'::regclass`)).rows[0];assert.equal(security.relrowsecurity,true);assert.equal(security.relforcerowsecurity,true)
 } finally {await db.query('ROLLBACK');await db.end()}
})
