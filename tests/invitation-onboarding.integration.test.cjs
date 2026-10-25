/* eslint-disable @typescript-eslint/no-require-imports */
const {test,before,after}=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto'),{AsyncLocalStorage}=require('node:async_hooks'),{Client}=require('pg'),bcrypt=require('bcryptjs')
const raw=process.env.CRM_TEST_DATABASE_URL,url=new URL(raw||'http://invalid')
if(!['127.0.0.1','localhost'].includes(url.hostname)||url.pathname!=='/ls_salon_crm_test')throw Error('Disposable local database only.')
const root=new Client({connectionString:raw}),sessions=new AsyncLocalStorage();url.username='crm_test_runtime';url.password='';process.env.DATABASE_URL=url.toString()
const authPath=require.resolve('../auth.ts');require.cache[authPath]={id:authPath,filename:authPath,loaded:true,exports:{auth:async()=>{await Promise.resolve();return sessions.getStore()||null}}}
const logger=require('../lib/logger.ts').logger;logger.info=()=>{};logger.error=()=>{}
const routes=require('../app/api/invites/route.ts'),{POST:accept}=require('../app/api/invites/accept/route.ts'),{DELETE:revoke}=require('../app/api/invites/[id]/route.ts')
const {prisma,runWithTenantDbContext}=require('../lib/prisma.ts'),{runWithDatabaseActor}=require('../lib/database-actor.ts')
const {defaultRecordRules}=require('../platform/access/rules.ts')
const tenant='invite_'+randomUUID().replaceAll('-',''),foreign=tenant+'_foreign',admin=tenant+'_admin',staff=tenant+'_staff',password='LocalInvitation!2026'
let office,otherOffice,profile
const actor=(id=admin,role='ADMIN',tenantId=tenant)=>({user:{id,role,tenantId}})
function req(method,path,body,host=tenant){return new Request(`http://${host}.localhost${path}`,{method,headers:{host:host+'.localhost','Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})})}
async function issue(extra={},session=actor()){
 const input={email:randomUUID()+'@example.test',role:'STAFF',delivery:'LINK',accessRoleIds:[profile],officeAccess:{creationOfficeId:office,officeIds:[office],companies:[]},...extra}
 const response=await sessions.run(session,()=>routes.POST(req('POST','/api/invites',input)))
 return{status:response.status,body:await response.json(),email:input.email}
}
async function issued(extra={}){const result=await issue(extra);assert.equal(result.status,201,result.body.error);const token=new URL(result.body.inviteUrl).searchParams.get('token');const row=(await root.query('SELECT id FROM "Invitation" WHERE token=$1',[token])).rows[0];return{...result,token,id:row.id}}
async function use(invite,extra={},host=tenant){const response=await accept(req('POST','/api/invites/accept',{token:invite.token,name:'Invited staff',password,...extra},host));return{status:response.status,body:await response.json()}}
async function cancel(invite,session=actor()){const response=await sessions.run(session,()=>revoke(req('DELETE','/api/invites/'+invite.id,undefined,session?.user.tenantId||tenant),{params:Promise.resolve({id:invite.id})}));return{status:response.status,body:await response.json()}}
const user=async email=>(await root.query('SELECT id,role,status,"passwordHash" FROM "User" WHERE "tenantId"=$1 AND lower(email)=lower($2)',[tenant,email])).rows[0]
const pending=async invite=>(await root.query('SELECT "acceptedAt" FROM "Invitation" WHERE id=$1',[invite.id])).rows[0]?.acceptedAt===null
before(async()=>{
 await root.connect()
 for(const t of [tenant,foreign])await root.query('INSERT INTO "Tenant"(id,name,slug,"updatedAt") VALUES($1,$1,$1,now())',[t])
 for(const [id,role,t]of[[admin,'ADMIN',tenant],[staff,'STAFF',tenant],[foreign+'_admin','ADMIN',foreign]])await root.query('INSERT INTO "User"(id,email,role,"tenantId","updatedAt") VALUES($1,$2,$3,$4,now())',[id,id+'@example.test',role,t])
 const initial=(await root.query('SELECT "companyId" FROM "BusinessOffice" WHERE "tenantId"=$1 AND "isInitial"',[tenant])).rows[0]
 office=tenant+'_east';await root.query('INSERT INTO "BusinessOffice"(id,"tenantId","companyId",code,name,"updatedAt") VALUES($1,$2,$3,\'INVITE_EAST\',\'Invite east\',now())',[office,tenant,initial.companyId])
 otherOffice=(await root.query('SELECT id FROM "BusinessOffice" WHERE "tenantId"=$1',[foreign])).rows[0].id
 profile=tenant+'_profile';await root.query('INSERT INTO "TenantAccessRole"(id,"tenantId",name,"nameKey",permissions,"updatedAt") VALUES($1,$2,\'Invite profile\',\'invite profile\',$3,now())',[profile,tenant,['dashboard.read','enquiries.read']])
})
after(async()=>{await root.end();await Promise.all([global.prisma,global.prismaBypassClient,...[...(global.prismaScopedClientCache?.values()||[])].map(entry=>entry.client)].filter(Boolean).map(client=>client.$disconnect()));await global.prismaPool?.end()})

test('link creation stores explicit access and audits without the token',async()=>{
 const invite=await issued({email:'Case-'+randomUUID()+'@EXAMPLE.TEST'})
 assert.equal(invite.body.emailSent,false);assert.equal(await user(invite.email),undefined)
 const saved=(await root.query('SELECT email,"accessConfiguration" FROM "Invitation" WHERE id=$1',[invite.id])).rows[0]
 assert.equal(saved.email,invite.email.toLowerCase());assert.deepEqual(saved.accessConfiguration.accessRoleIds,[profile]);assert.equal(saved.accessConfiguration.officeAccess.creationOfficeId,office)
 const audit=(await root.query('SELECT "after" FROM "AuditLog" WHERE "entityId"=$1 AND event=\'core.invitations.create\'',[invite.id])).rows[0]
 assert(!JSON.stringify(audit).includes(invite.token))
})
test('generated links preserve the authenticated forwarded tenant host, protocol and development port',async()=>{
 const response=await sessions.run(actor(),()=>routes.POST(new Request('http://localhost:3108/api/invites',{method:'POST',headers:{host:'localhost:3108','x-forwarded-host':tenant+'.localhost:3108','x-forwarded-proto':'https','Content-Type':'application/json'},body:JSON.stringify({email:randomUUID()+'@example.test',role:'CUSTOMER',delivery:'LINK'})})))
 assert.equal(response.status,201);assert.equal(new URL((await response.json()).inviteUrl).origin,'https://'+tenant+'.localhost:3108')
})
test('acceptance creates exactly the proposed account, profiles and office policy atomically',async()=>{
 const invite=await issued(),response=await use(invite);assert.equal(response.status,200,response.body.error)
 const created=await user(invite.email);assert.equal(created.role,'STAFF');assert.equal(created.status,'ACTIVE');assert(await bcrypt.compare(password,created.passwordHash))
 assert.deepEqual((await root.query('SELECT "roleId" FROM "TenantRoleAssignment" WHERE "userId"=$1',[created.id])).rows,[{roleId:profile}])
 assert.deepEqual((await root.query('SELECT "creationOfficeId" FROM "BusinessOfficePolicy" WHERE "userId"=$1',[created.id])).rows,[{creationOfficeId:office}])
 assert.equal(await pending(invite),false)
 assert.equal((await use(invite)).status,400)
 const audit=(await root.query('SELECT "after",metadata FROM "AuditLog" WHERE "entityId"=$1 AND event=\'core.invitations.accept\'',[invite.id])).rows[0]
 assert.equal(audit.after.userId,created.id);assert.equal(audit.metadata.invitedById,admin);assert(!JSON.stringify(audit).includes(password))
})
test('acceptance cannot modify role, access or office configuration from the browser',async()=>{
 for(const injected of [{role:'ADMIN'},{accessRoleIds:[]},{officeAccess:{creationOfficeId:otherOffice,officeIds:[otherOffice],companies:[]}}]){
  const invite=await issued();assert.equal((await use(invite,injected)).status,400);assert.equal(await pending(invite),true);assert.equal(await user(invite.email),undefined)
 }
})
test('inviting or accepting for an existing account never changes its credentials or permissions',async()=>{
 assert.equal((await issue({email:admin+'@example.test',role:'ADMIN',accessRoleIds:[]})).status,409)
 const invite=await issued(),hash=await bcrypt.hash('ExistingPassword!2026',10)
 await root.query('INSERT INTO "User"(id,email,role,"tenantId","passwordHash","updatedAt") VALUES($1,$2,\'CUSTOMER\',$3,$4,now())',[invite.id+'_existing',invite.email.toUpperCase(),tenant,hash])
 const before=await user(invite.email);assert.equal((await use(invite)).status,409);assert.deepEqual(await user(invite.email),before);assert.equal(await pending(invite),true)
})
test('cross-tenant acceptance, public enumeration and ordinary staff token reads are denied',async()=>{
 const invite=await issued();assert.equal((await use(invite,{},foreign)).status,400)
 const rows=await runWithTenantDbContext(tenant,()=>runWithDatabaseActor(staff,()=>prisma.invitation.findMany()));assert.deepEqual(rows,[])
 const noActor=await runWithTenantDbContext(tenant,()=>prisma.invitation.findMany());assert.deepEqual(noActor,[])
 const audit=await runWithTenantDbContext(tenant,()=>runWithDatabaseActor(staff,()=>prisma.auditLog.findMany({where:{entityType:'Invitation'}})));assert.deepEqual(audit,[])
 const result=await runWithTenantDbContext(tenant,()=>prisma.$queryRaw`SELECT * FROM app.invitation_accept_context(${foreign},${invite.token})`);assert.deepEqual(result,[])
 assert.equal((await cancel(invite,actor(foreign+'_admin','ADMIN',foreign))).status,404)
})
test('only current administrators can create/revoke invitations; email is optional only for link delivery',async()=>{
 assert.equal((await issue({},actor(staff,'STAFF'))).status,403);assert.equal((await issue({},null)).status,401)
 const response=await issue({delivery:'EMAIL'});assert.equal(response.status,400);assert.equal((await root.query('SELECT id FROM "Invitation" WHERE email=$1',[response.email])).rowCount,0)
 const invite=await issued();assert.equal((await cancel(invite,actor(staff,'STAFF'))).status,403)
})
test('duplicate pending invitations, invalid profiles and foreign offices fail before storage',async()=>{
 const invite=await issued();assert.equal((await issue({email:invite.email.toUpperCase()})).status,409)
 for(const extra of [{accessRoleIds:['missing']},{accessRoleIds:[profile,profile]},{role:'CUSTOMER'},{officeAccess:{creationOfficeId:otherOffice,officeIds:[otherOffice],companies:[]}}]){
  const result=await issue(extra);assert.equal(result.status,400,result.body.error);assert.equal((await root.query('SELECT id FROM "Invitation" WHERE email=$1',[result.email])).rowCount,0)
 }
})
test('email success and failure are reported accurately without changing the saved invitation capability',async()=>{
 const mail=require('../lib/mailer.ts'),previous={can:mail.canSendConfiguredEmail,from:mail.mailFrom,send:mail.mailer.sendMail}
 let sent=0
 mail.canSendConfiguredEmail=async()=>true;mail.mailFrom='local-test@example.test'
 try{
  mail.mailer.sendMail=async()=>{sent++;return{}}
  const delivered=await issue({delivery:'EMAIL'});assert.equal(delivered.status,200);assert.equal(delivered.body.emailSent,true);assert.equal(sent,1)
  mail.mailer.sendMail=async()=>{throw Error('Synthetic delivery failure')}
  const failed=await issue({delivery:'EMAIL'});assert.equal(failed.status,201);assert.equal(failed.body.emailSent,false);assert(failed.body.warning.includes('Copy invite link'))
  assert.equal((await root.query('SELECT id FROM "Invitation" WHERE email=$1 AND "acceptedAt" IS NULL',[failed.email])).rowCount,1)
 }finally{mail.canSendConfiguredEmail=previous.can;mail.mailFrom=previous.from;mail.mailer.sendMail=previous.send}
})
test('archived profiles and closed creation offices are checked again when accepting',async()=>{
 const a=await issued();await root.query('UPDATE "TenantAccessRole" SET archived=true WHERE id=$1',[profile])
 try{assert.equal((await use(a)).status,400);assert.equal(await pending(a),true);assert.equal(await user(a.email),undefined)}finally{await root.query('UPDATE "TenantAccessRole" SET archived=false WHERE id=$1',[profile])}
 const b=await issued();await root.query('UPDATE "BusinessOffice" SET archived=true WHERE id=$1',[office])
 try{assert.equal((await use(b)).status,400);assert.equal(await user(b.email),undefined)}finally{await root.query('UPDATE "BusinessOffice" SET archived=false WHERE id=$1',[office])}
})
test('expired or revoked tokens cannot create accounts',async()=>{
 const expired=await issued();await root.query('UPDATE "Invitation" SET "expiresAt"=now()-interval \'1 minute\' WHERE id=$1',[expired.id]);assert.equal((await use(expired)).status,400)
 const revoked=await issued();assert.equal((await cancel(revoked)).status,200);assert.equal((await use(revoked)).status,400)
 assert.equal(await user(expired.email),undefined);assert.equal(await user(revoked.email),undefined)
})
test('demoted/suspended inviters and suspended tenants invalidate pending invitations immediately',async()=>{
 const invite=await issued()
 for(const update of ['role=\'STAFF\'','status=\'SUSPENDED\'']){
  await root.query('UPDATE "User" SET '+update+' WHERE id=$1',[admin]);try{assert.equal((await use(invite)).status,400)}finally{await root.query('UPDATE "User" SET role=\'ADMIN\',status=\'ACTIVE\' WHERE id=$1',[admin])}
 }
 await root.query('UPDATE "Tenant" SET status=\'SUSPENDED\' WHERE id=$1',[tenant]);try{assert([400,404].includes((await use(invite)).status))}finally{await root.query('UPDATE "Tenant" SET status=\'ACTIVE\' WHERE id=$1',[tenant])}
 assert.equal(await user(invite.email),undefined)
})
test('two concurrent acceptances consume a token once',async()=>{
 const invite=await issued(),results=await Promise.all([use(invite),use(invite)]);assert.deepEqual(results.map(result=>result.status).sort(),[200,400])
 assert.equal((await root.query('SELECT id FROM "User" WHERE "tenantId"=$1 AND email=$2',[tenant,invite.email])).rowCount,1)
 assert.equal((await cancel(invite)).status,409)
})
test('acceptance and revocation serialize without an orphan account or inconsistent result',async()=>{
 const invite=await issued(),[accepted,revoked]=await Promise.all([use(invite),cancel(invite)])
 if(accepted.status===200){assert.equal(revoked.status,409);assert(await user(invite.email));assert.equal(await pending(invite),false)}else{assert.equal(accepted.status,400);assert.equal(revoked.status,200);assert.equal(await user(invite.email),undefined)}
})
test('mandatory create/accept/revoke audit failure rolls back the whole operation',async()=>{
 for(const event of ['core.invitations.create','core.invitations.accept','core.invitations.archive']){
  const invite=event.endsWith('create')?null:await issued()
  await root.query(`ALTER TABLE "AuditLog" ADD CONSTRAINT invite_audit_failure CHECK(event <> '${event}') NOT VALID`)
  try{
   if(!invite){const result=await issue();assert.equal(result.status,500);assert.equal((await root.query('SELECT id FROM "Invitation" WHERE email=$1',[result.email])).rowCount,0)}
   else if(event.endsWith('accept')){assert.equal((await use(invite)).status,500);assert.equal(await pending(invite),true);assert.equal(await user(invite.email),undefined)}
   else{assert.equal((await cancel(invite)).status,500);assert.equal(await pending(invite),true)}
  }finally{await root.query('ALTER TABLE "AuditLog" DROP CONSTRAINT invite_audit_failure')}
 }
 assert.equal(await prisma.user.count(),0,'public acceptance must not leak its actor or tenant context')
})
test('an invitation with no proposed access creates an unassigned account without inheriting the inviter',async()=>{
 const invite=await issued({accessRoleIds:[],officeAccess:undefined,recordRules:defaultRecordRules()}),result=await use(invite);assert.equal(result.status,200,result.body.error)
 const created=await user(invite.email);assert.equal((await root.query('SELECT * FROM "BusinessOfficePolicy" WHERE "userId"=$1',[created.id])).rowCount,0);assert.equal((await root.query('SELECT * FROM "TenantRoleAssignment" WHERE "userId"=$1',[created.id])).rowCount,0)
})
