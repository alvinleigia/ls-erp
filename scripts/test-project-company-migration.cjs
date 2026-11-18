/* eslint-disable @typescript-eslint/no-require-imports */
// Owns a disposable Docker database. Never loads hosted environment files.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{randomBytes,randomUUID,createHash}=require('node:crypto'),{spawnSync,spawn}=require('node:child_process'),{Client}=require('pg')
const root=path.resolve(__dirname,'..'),suffix=randomBytes(6).toString('hex'),name='ls-erp-company-rehearsal-'+suffix,database='ls_erp_company_rehearsal_'+suffix
function docker(args){const r=spawnSync('docker',args,{windowsHide:true,encoding:'utf8',maxBuffer:8*1024*1024});assert.equal(r.status,0,'Disposable Docker command failed');return r.stdout.trim()}
async function main(){
  let started=false,db
  try{
    docker(['run','--detach','--name',name,'--label','ls-erp.company-rehearsal='+suffix,'--publish','127.0.0.1::5432','--env','POSTGRES_HOST_AUTH_METHOD=trust','--env','POSTGRES_DB='+database,'postgres:17-alpine']);started=true
    const port=JSON.parse(docker(['inspect',name]))[0].NetworkSettings.Ports['5432/tcp'][0].HostPort,url=`postgresql://postgres@127.0.0.1:${port}/${database}`
    for(let i=0;i<60;i++){const c=new Client({connectionString:url});try{await c.connect();db=c;break}catch{await c.end().catch(()=>{});await new Promise(r=>setTimeout(r,250))}}
    assert(db,'Disposable database did not start')
    await db.query('CREATE ROLE crm_test_runtime LOGIN NOSUPERUSER NOBYPASSRLS; ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT,INSERT,UPDATE,DELETE ON TABLES TO crm_test_runtime; ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE,SELECT ON SEQUENCES TO crm_test_runtime')
    await db.query('CREATE TABLE _prisma_migrations(id varchar(36) PRIMARY KEY,checksum varchar(64) NOT NULL,finished_at timestamptz,migration_name varchar(255) NOT NULL,logs text,rolled_back_at timestamptz,started_at timestamptz NOT NULL DEFAULT now(),applied_steps_count integer NOT NULL DEFAULT 0)')
    const directory=path.join(root,'prisma/migrations'),migrations=fs.readdirSync(directory,{withFileTypes:true}).filter(e=>e.isDirectory()).map(e=>e.name).sort()
    for(const migration of migrations){const sql=fs.readFileSync(path.join(directory,migration,'migration.sql'),'utf8');try{await db.query(sql)}catch(e){throw Error('Fresh migration failed at '+migration+': '+e.message)}await db.query('INSERT INTO _prisma_migrations(id,checksum,migration_name,finished_at) VALUES($1,$2,$3,now())',[randomUUID(),createHash('sha256').update(sql).digest('hex'),migration])}
    await db.query('GRANT USAGE ON SCHEMA public,app TO crm_test_runtime; GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO crm_test_runtime; GRANT EXECUTE ON FUNCTION app.external_business_actor() TO crm_test_runtime')
    await db.end();db=null
    console.log(`Fresh ${migrations.length}-migration disposable database prepared.`)
    const env={...process.env,COMPANY_MIGRATION_TEST_DATABASE_URL:url,COMPANY_MIGRATION_TEST_RUN:'1',DATABASE_URL:url,DIRECT_URL:url,SUPABASE_URL:'',SUPABASE_SECRET_KEY:'',SUPABASE_SERVICE_ROLE_KEY:'',SMTP_HOST:'',MAIL_FROM:''}
    const exit=await new Promise((resolve,reject)=>{const p=spawn(process.execPath,['--require','./tests/register.cjs','--test','--test-force-exit','tests/project-company-migration.integration.test.cjs'],{cwd:root,env,windowsHide:true,stdio:'inherit'});p.on('error',reject);p.on('close',resolve)})
    assert.equal(exit,0,'Project company migration checks failed')
  }finally{await db?.end();if(started){assert.equal(docker(['inspect',name,'--format','{{index .Config.Labels "ls-erp.company-rehearsal"}}']),suffix);docker(['rm','--force',name])}}
}
main().catch(e=>{console.error(e.message);process.exitCode=1})
