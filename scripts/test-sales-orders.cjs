/* eslint-disable @typescript-eslint/no-require-imports */
// Isolated synthetic database only. Never loads environment files or hosted credentials.
const fs=require('node:fs'),path=require('node:path'),{spawn}=require('node:child_process'),{randomBytes}=require('node:crypto')
const root=path.resolve(__dirname,'..'),name='ls-erp-sales-orders-'+randomBytes(6).toString('hex')
const report=path.join(root,'tmp','industry-release',name+'.log');fs.mkdirSync(path.dirname(report),{recursive:true});const log=fs.createWriteStream(report)
function run(command,args,env={}){return new Promise((resolve,reject)=>{const p=spawn(command,args,{cwd:root,env:{...process.env,...env},windowsHide:true});const out=[];p.stdout.on('data',b=>{out.push(b);log.write(b)});p.stderr.on('data',b=>log.write(b));p.on('error',reject);p.on('close',code=>code===0?resolve(Buffer.concat(out).toString()):reject(new Error(`Check failed (${code}); see ${report}`)))})}
const docker=(args)=>run('docker',args)
async function main(){
 const image=(await docker(['image','inspect','postgres:17-alpine','--format','{{.Id}}'])).trim()
 let started=false
 try{
 await docker(['run','--detach','--name',name,'--publish','127.0.0.1::5432','--tmpfs','/var/lib/postgresql/data:rw,noexec,nosuid,size=512m','--env','POSTGRES_HOST_AUTH_METHOD=trust','--env','POSTGRES_DB=ls_salon_crm_test',image]);started=true
 for(let i=0;;i++){try{await docker(['exec',name,'pg_isready','-U','postgres','-d','ls_salon_crm_test']);break}catch(e){if(i>=29)throw e;await new Promise(r=>setTimeout(r,500))}}
 const port=(await docker(['port',name,'5432/tcp'])).trim().split(':').pop()
 const url=`postgresql://postgres@127.0.0.1:${port}/ls_salon_crm_test`
 const env={CRM_TEST_DATABASE_URL:url,DATABASE_URL:url,DIRECT_URL:url,NODE_ENV:'test',R5_HISTORICAL_CONTAINER:'1',SUPABASE_URL:'',SUPABASE_SECRET_KEY:'',SUPABASE_SERVICE_ROLE_KEY:'',SMTP_HOST:'',MAIL_FROM:''}
 const nodeImage=(await docker(['image','inspect','node:24-alpine','--format','{{.Id}}'])).trim()
 const mounts=['node_modules','prisma','tests','docs','scripts'].flatMap(src=>['--mount',`type=bind,source=${path.join(root,src)},target=/work/${src},readonly`])
 for(const helper of ['historical-upgrade','catalog-migration','branding-migration','quotation-archive-migration','sales-orders-migration','unit-reservations-migration','order-receivables-migration','collection-follow-ups-migration','flexible-team-intake-migration','business-team-access-migration','composable-profiles-migration','resource-action-policies-migration','record-sharing-migration','company-office-migration'])console.log((await docker(['run','--rm','--network',`container:${name}`,'--workdir','/work','--env','R5_HISTORICAL_CONTAINER=1','--env','CRM_TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:5432/ls_salon_crm_test',...mounts,nodeImage,'node',`tests/helpers/${helper}.cjs`])).trim())
 if(process.argv.includes('--migration-only'))return
 const files=process.argv.includes('--companies')?['company-office.integration']:process.argv.includes('--sharing')?['record-sharing.integration']:process.argv.includes('--crm')?['crm.integration','crm-sales.integration','custom-fields.integration','audit-review.integration','module-access.integration','settings-work.integration','users.integration','branding.integration','terminology.integration']:process.argv.includes('--profiles')?['resource-action-policies','access-profiles','access-profiles.integration']:process.argv.includes('--access')?['resource-action-policies','leave-notifications','access-profiles','access-profiles.integration','business-team-access.integration','crm-record-scopes.integration','access-roles.integration','real-estate.integration','core-access.integration','workforce-access.integration','appointments-access.integration','inventory-access.integration','services-access.integration','dashboard.integration','catalog.integration']:process.argv.includes('--teams')?['crm-teams.integration','crm-import.integration']:['order-receivables.integration','unit-reservations.integration','sales-orders.integration','catalog.integration','quotations.integration']
 if(!process.argv.includes('--browser-only')){
 console.log(process.argv.includes('--companies')?'Running company and office checks.':process.argv.includes('--access')?'Running ERP access checks.':process.argv.includes('--teams')?'Running sales team and enquiry import checks.':'Running sales order and quotation checks.')
 const output=await run(process.execPath,['--require','./tests/register.cjs','--test','--test-reporter=tap','--test-concurrency=1','--test-force-exit','--test-timeout=60000',...files.map(f=>`tests/${f}.test.cjs`)],env)
 console.log(output.split('\n').filter(l=>/^# (tests|pass|fail|skipped)/.test(l)).join('\n'))
 }
 if(process.argv.includes('--browser')||process.argv.includes('--browser-only'))console.log(await run(process.execPath,['node_modules/@playwright/test/cli.js','test','--config','playwright.local-access.config.ts',...(process.argv.includes('--companies')?['company-office.spec.ts']:process.argv.includes('--sharing')?['sharing.spec.ts']:process.argv.includes('--profiles')?['access-profiles.spec.ts']:process.argv.includes('--access')?['access-profiles.spec.ts','business-teams.spec.ts','access.spec.ts','sharing.spec.ts']:process.argv.includes('--teams')?['team-intake.spec.ts','terminology-configuration.spec.ts']:['sales-orders.spec.ts'])],env))
 console.log('Evidence: '+report)
 }finally{if(started)await docker(['rm','--force',name])}
}main().catch(e=>{console.error(e.message);process.exitCode=1}).finally(()=>log.end())
