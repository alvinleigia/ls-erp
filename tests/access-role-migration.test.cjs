/* eslint-disable @typescript-eslint/no-require-imports */
const { test }=require('node:test'), assert=require('node:assert/strict'), fs=require('node:fs'), {Client}=require('pg'), {randomUUID}=require('node:crypto')
test('role migration preserves legacy users, adds composite isolation and enforces RLS',async()=>{
 const url=new URL(process.env.CRM_TEST_DATABASE_URL||'http://invalid')
 if (!['localhost','127.0.0.1'].includes(url.hostname)||url.pathname!='/ls_salon_crm_test')throw Error('Disposable local database only.')
 const db=new Client({connectionString:url.toString()});await db.connect()
 try {
 await db.query('BEGIN')
 const schema=`roles_${randomUUID().replaceAll('-','')}`
 await db.query(`CREATE SCHEMA ${schema} AUTHORIZATION crm_test_runtime; SET LOCAL search_path TO ${schema}; SET LOCAL ROLE crm_test_runtime;
 CREATE TABLE "Tenant" (id text PRIMARY KEY); CREATE TABLE "User" (id text PRIMARY KEY,"tenantId" text,role text,UNIQUE("tenantId",id));
 INSERT INTO "Tenant" VALUES ('a'),('b'); INSERT INTO "User" VALUES ('admin','a','ADMIN'),('staff','a','STAFF'),('other','b','STAFF');`)
 await db.query(fs.readFileSync('prisma/migrations/20260930120000_tenant_access_roles/migration.sql','utf8').replace(/^BEGIN;/,'').replace(/COMMIT;\s*$/,''))
 assert.equal((await db.query('SELECT * FROM "User"')).rowCount,3)
 assert.equal((await db.query('SELECT * FROM "TenantRoleAssignment"')).rowCount,0)
 await db.query(`SET LOCAL app.tenant_id='a'; INSERT INTO "TenantAccessRole" (id,"tenantId",name,"nameKey",permissions,"updatedAt") VALUES ('readonly','a','Read only','read only',ARRAY['enquiries.read'],NOW()); INSERT INTO "TenantRoleAssignment" VALUES ('a','staff','readonly',NOW());`)
 await db.query(`SET LOCAL app.tenant_id='b'`)
 assert.equal((await db.query('SELECT * FROM "TenantAccessRole"')).rowCount,0)
 assert.equal((await db.query('SELECT * FROM "TenantRoleAssignment"')).rowCount,0)
 await db.query('SAVEPOINT invalid_assignment')
 await assert.rejects(db.query(`INSERT INTO "TenantRoleAssignment" VALUES ('b','other','readonly',NOW())`),e=>e.code==='23503')
 await db.query('ROLLBACK TO SAVEPOINT invalid_assignment')
 } finally {await db.query('ROLLBACK');await db.end()}
})
