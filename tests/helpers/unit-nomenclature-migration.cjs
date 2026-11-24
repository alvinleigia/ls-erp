/* eslint-disable @typescript-eslint/no-require-imports */
const fs=require('node:fs'),assert=require('node:assert/strict'),{createHash,randomUUID}=require('node:crypto'),{Client}=require('pg')
async function main(){
 assert.equal(process.env.R5_HISTORICAL_CONTAINER,'1');const url=new URL(process.env.CRM_TEST_DATABASE_URL);assert.equal(url.hostname,'127.0.0.1');assert.equal(url.pathname,'/ls_salon_crm_test');const db=new Client({connectionString:url.toString()});await db.connect()
 try{
 const user=(await db.query('SELECT id,"tenantId" FROM "User" ORDER BY id LIMIT 1')).rows[0],job='nomenclature-history-'+randomUUID()
 await db.query('INSERT INTO "CatalogImport"(id,"tenantId","createdByUserId",profile,"templateVersion","fileName",headers,status,"updatedAt") VALUES($1,$2,$3,\'catalog\',2,\'history.csv\',\'["item_code"]\',\'REVIEW\',now())',[job,user.tenantId,user.id])
 await db.query('INSERT INTO "CatalogImportRow"("tenantId","importId","rowNumber",values,status,"itemCode") VALUES($1,$2,2,\'["OLD-01"]\',\'READY\',\'OLD-01\')',[user.tenantId,job])
 const tables=(await db.query("SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename<>'_prisma_migrations' ORDER BY tablename")).rows.map(r=>r.tablename)
 const snapshot=async(after=false)=>Promise.all(tables.map(async table=>{const projection=table==='RealEstateUnit'?"-'unitNumber'-'companyCode'-'floor'":table==='CatalogImportRow'&&after?"-'matchKeys'||jsonb_build_object('itemCode',t.\"matchKeys\"[1])":'';return (await db.query(`SELECT md5(coalesce(string_agg(row::text,'' ORDER BY row::text COLLATE "C"),'')) digest FROM (SELECT (to_jsonb(t)${projection}) row FROM "${table}" t) rows`)).rows[0].digest}))
 const before=await snapshot(),name='20261121000100_unit_nomenclature',sql=fs.readFileSync(`prisma/migrations/${name}/migration.sql`,'utf8')
 await assert.rejects(db.query(sql.replace(/COMMIT;\s*$/,'SELECT 1/0; COMMIT;')),/division by zero/);await db.query('ROLLBACK');assert.deepEqual(await snapshot(),before)
 await db.query(sql);assert.deepEqual(await snapshot(true),before)
 assert.equal((await db.query('SELECT count(*)::int n FROM "RealEstateUnit" u JOIN "CatalogItem" i ON i.id=u."itemId" AND i."tenantId"=u."tenantId" WHERE u."companyCode" IS DISTINCT FROM i.code OR u."unitNumber" IS NOT NULL OR u.floor IS NOT NULL')).rows[0].n,0)
 await db.query('INSERT INTO "_prisma_migrations"(id,checksum,migration_name,finished_at) VALUES($1,$2,$3,now())',[randomUUID(),createHash('sha256').update(sql).digest('hex'),name]);console.log(`Unit nomenclature: forced rollback and all ${tables.length} prior tables preserved; old codes copied exactly, snapshots and access unchanged.`)
 }finally{await db.end()}
}main().catch(e=>{console.error(e);process.exitCode=1})
