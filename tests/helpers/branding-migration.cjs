/* eslint-disable @typescript-eslint/no-require-imports */
const assert=require('node:assert/strict'),fs=require('node:fs'),{Client}=require('pg'),{createHash}=require('node:crypto')
async function main(){
 const url=new URL(process.env.CRM_TEST_DATABASE_URL);assert.equal(url.hostname,'127.0.0.1');assert.equal(url.pathname,'/ls_salon_crm_test')
 const db=new Client({connectionString:url.toString()});await db.connect()
 try{
 await db.query(`INSERT INTO "AppointmentOrder" (id,"tenantId","customerId","appointmentDate","appointmentStartAt","updatedAt","totalCents")
   VALUES ('branding_migration_probe','crm_upgrade','crm_upgrade_user','2026-01-01','2026-01-01T10:00:00Z',now(),12345)`)
 const before=(await db.query('SELECT * FROM "AppointmentOrder" ORDER BY id')).rows
 const name='20261019000100_tenant_branding',sql=fs.readFileSync(`prisma/migrations/${name}/migration.sql`,'utf8')
 await db.query(sql)
 const after=(await db.query('SELECT * FROM "AppointmentOrder" ORDER BY id')).rows
 assert.deepEqual(after.map(row=>{const original={...row};delete original.invoiceBranding;return original}),before)
 assert.ok(after.every(row=>row.invoiceBranding?.logo===null))
 assert.equal(after.find(row=>row.id==='branding_migration_probe').invoiceBranding.name,'crm_upgrade')
 await db.query('INSERT INTO _prisma_migrations (id,checksum,migration_name,finished_at) VALUES ($1,$2,$1,now())',[name,createHash('sha256').update(sql).digest('hex')])
 console.log('Branding migration preserves existing order fields and freezes document identity.')
 }finally{await db.end()}
}main().catch(e=>{console.error(e.message);process.exitCode=1})
