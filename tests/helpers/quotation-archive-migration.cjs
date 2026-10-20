/* eslint-disable @typescript-eslint/no-require-imports */
const assert=require('node:assert/strict'),fs=require('node:fs'),{Client}=require('pg'),{createHash}=require('node:crypto')
async function main(){
 const url=new URL(process.env.CRM_TEST_DATABASE_URL);assert.equal(url.hostname,'127.0.0.1');assert.equal(url.pathname,'/ls_salon_crm_test')
 const db=new Client({connectionString:url.toString()});await db.connect()
 try{
 const before=(await db.query('SELECT * FROM "CrmQuotationRevision" ORDER BY "tenantId","quotationId",number')).rows
 const name='20261020000100_quotation_pdf_archive',sql=fs.readFileSync(`prisma/migrations/${name}/migration.sql`,'utf8')
 await db.query(sql)
 const after=(await db.query('SELECT * FROM "CrmQuotationRevision" ORDER BY "tenantId","quotationId",number')).rows
 assert.deepEqual(after.map(({archivedPdf,...row})=>{assert.equal(archivedPdf,null);return row}),before)
 await db.query('INSERT INTO _prisma_migrations (id,checksum,migration_name,finished_at) VALUES ($1,$2,$1,now())',[name,createHash('sha256').update(sql).digest('hex')])
 console.log('Quotation archive migration preserves existing revision snapshots.')
 }finally{await db.end()}
}main().catch(e=>{console.error(e.message);process.exitCode=1})
