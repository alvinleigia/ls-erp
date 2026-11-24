/* eslint-disable @typescript-eslint/no-require-imports */
const fs=require('node:fs'),assert=require('node:assert/strict'),{createHash,randomUUID}=require('node:crypto'),{Client}=require('pg')
async function main(){
 assert.equal(process.env.R5_HISTORICAL_CONTAINER,'1');const url=new URL(process.env.CRM_TEST_DATABASE_URL);assert.equal(url.hostname,'127.0.0.1');assert.equal(url.pathname,'/ls_salon_crm_test')
 const db=new Client({connectionString:url.toString()});await db.connect()
 try{
  const tenant='pricing-migration-'+randomUUID(),user=tenant+'-admin',item=tenant+'-priced',free=tenant+'-free'
  await db.query('INSERT INTO "Tenant"(id,slug,name,"updatedAt") VALUES($1,$1,$1,now())',[tenant])
  await db.query('INSERT INTO "User"(id,"tenantId",name,email,role,"updatedAt") VALUES($1,$2,\'Synthetic admin\',$3,\'ADMIN\',now())',[user,tenant,user+'@example.test'])
  for(const [id,price]of [[item,'125.25'],[free,'0']])await db.query('INSERT INTO "CatalogItem"("tenantId",id,code,name,kind,price,currency,"updatedAt") VALUES($1,$2,$3,\'Synthetic stock\',\'PRODUCT\',$4,\'INR\',now())',[tenant,id,price==='0'?'FREE':'PRICED',price])
  await db.query('INSERT INTO "CatalogImport"("tenantId",id,"createdByUserId",profile,"templateVersion","fileName",headers,"updatedAt") VALUES($1,$2,$3,\'catalog\',3,\'history.csv\',\'["item_code"]\',now())',[tenant,tenant+'-import',user])
  const tables=(await db.query("SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename<>'_prisma_migrations' ORDER BY tablename")).rows.map(r=>r.tablename)
  const snapshot=()=>Promise.all(tables.map(async table=>(await db.query(`SELECT md5(coalesce(string_agg(row::text,'' ORDER BY row::text COLLATE "C"),'')) digest FROM (SELECT to_jsonb(t)${table==='CatalogImport'?"-'defaultCurrency'":''} row FROM "${table}" t) rows`)).rows[0].digest))
  const before=await snapshot(),name='20261121000200_catalog_optional_pricing',sql=fs.readFileSync(`prisma/migrations/${name}/migration.sql`,'utf8')
  await assert.rejects(db.query(sql.replace(/COMMIT;\s*$/,'SELECT 1/0; COMMIT;')),/division by zero/);await db.query('ROLLBACK');assert.deepEqual(await snapshot(),before)
  assert.equal((await db.query("SELECT attnotnull FROM pg_attribute WHERE attrelid='\"CatalogItem\"'::regclass AND attname='price'")).rows[0].attnotnull,true)
  await db.query(sql);assert.deepEqual(await snapshot(),before)
  await db.query('BEGIN');await db.query('UPDATE "CatalogItem" SET price=NULL WHERE "tenantId"=$1 AND id=$2',[tenant,item]);assert.equal((await db.query('SELECT price FROM "CatalogItem" WHERE "tenantId"=$1 AND id=$2',[tenant,item])).rows[0].price,null)
  await db.query('SAVEPOINT negative_price');await assert.rejects(db.query('UPDATE "CatalogItem" SET price=-1 WHERE "tenantId"=$1 AND id=$2',[tenant,item]),/check constraint/);await db.query('ROLLBACK TO SAVEPOINT negative_price');await db.query('ROLLBACK');assert.deepEqual(await snapshot(),before)
  await db.query('INSERT INTO "_prisma_migrations"(id,checksum,migration_name,finished_at) VALUES($1,$2,$3,now())',[randomUUID(),createHash('sha256').update(sql).digest('hex'),name])
  console.log(`Optional catalog pricing: forced rollback and all ${tables.length} prior tables preserved; priced/free items retained, null allowed, negative prices rejected and import source metadata immutable.`)
 }finally{await db.end()}
}main().catch(e=>{console.error(e);process.exitCode=1})
