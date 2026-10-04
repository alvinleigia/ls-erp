/* eslint-disable @typescript-eslint/no-require-imports */
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),{Client}=require('pg'),{randomUUID}=require('node:crypto')
test('CRM scope migration preserves legacy roles and does not promote existing team members',async()=>{
 const url=new URL(process.env.CRM_TEST_DATABASE_URL||'http://invalid')
 if(!['localhost','127.0.0.1'].includes(url.hostname)||url.pathname!='/ls_salon_crm_test')throw Error('Disposable local database only.')
 const db=new Client({connectionString:url.toString()});await db.connect()
 try {
  await db.query('BEGIN')
  const schema=`scope_${randomUUID().replaceAll('-','')}`
  await db.query(`CREATE SCHEMA ${schema}; SET LOCAL search_path TO ${schema};
   CREATE TABLE "TenantAccessRole" (id text PRIMARY KEY, permissions text[]);
   CREATE TABLE "CrmSalesTeamMember" ("teamId" text,"userId" text);
   INSERT INTO "TenantAccessRole" VALUES ('legacy',ARRAY['enquiries.read']);
   INSERT INTO "CrmSalesTeamMember" VALUES ('sales','manager'),('sales','staff');`)
  await db.query(fs.readFileSync('prisma/migrations/20261004110000_crm_record_scopes/migration.sql','utf8'))
  assert.deepEqual((await db.query('SELECT * FROM "TenantAccessRole"')).rows,[{id:'legacy',permissions:['enquiries.read'],crmRecordScope:'ACCOUNT_ROLE'}])
  assert.deepEqual((await db.query('SELECT "isManager" FROM "CrmSalesTeamMember"')).rows,[{isManager:false},{isManager:false}])
  await db.query('SAVEPOINT invalid_scope')
  await assert.rejects(db.query(`UPDATE "TenantAccessRole" SET "crmRecordScope"='INVALID'`),e=>e.code==='23514')
  await db.query('ROLLBACK TO SAVEPOINT invalid_scope')
  await db.query(`INSERT INTO "TenantAccessRole" (id) VALUES ('new')`)
  assert.equal((await db.query(`SELECT "crmRecordScope" FROM "TenantAccessRole" WHERE id='new'`)).rows[0].crmRecordScope,'ACCOUNT_ROLE')
 } finally {await db.query('ROLLBACK');await db.end()}
})
