/* eslint-disable @typescript-eslint/no-require-imports */
const {test,before,after}=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto'),{AsyncLocalStorage}=require('node:async_hooks'),{Client}=require('pg')
const raw=process.env.CRM_TEST_DATABASE_URL,url=new URL(raw||'http://invalid');if(!['localhost','127.0.0.1'].includes(url.hostname)||url.pathname!='/ls_salon_crm_test')throw Error('Disposable local database only.')
const root=new Client({connectionString:raw}),sessions=new AsyncLocalStorage();url.username='crm_test_runtime';url.password='';process.env.DATABASE_URL=url.toString()
const authPath=require.resolve('../auth.ts');require.cache[authPath]={id:authPath,filename:authPath,loaded:true,exports:{auth:async()=>sessions.getStore()||null}}
const logger=require('../lib/logger.ts').logger;logger.info=()=>{};logger.error=()=>{}
const {prisma}=require('../lib/prisma.ts'),{allPermissions}=require('../platform/access/catalog.ts'),{defaultRecordRules}=require('../platform/access/rules.ts')
const tenant='external_login_'+randomUUID().replaceAll('-',''),foreign=tenant+'_foreign',admin=tenant+'_admin',manager=tenant+'_manager',internal=tenant+'_internal',password='IsolatedExternal!2026'
let collaborator,second,partner,broad,invitation,office,rules
async function api(module,path,method='GET',body,user=admin,status=200,params={},host=tenant){
 const response=await sessions.run(user?{user:{id:user,tenantId:host,role:'ADMIN'}}:null,()=>require('../app/api/'+module+'/route.ts')[method](new Request('http://'+host+'.localhost'+path,{method,headers:{host:host+'.localhost','Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})}),{params:Promise.resolve(params)}))
 const data=await response.json();assert.equal(response.status,status,path+': '+data.error);return data
}
const patch=(id,body,status=200)=>api('users/[id]','/api/users/'+id,'PATCH',body,admin,status,{id})
const update=(row,body,status=200)=>api('collaborators/[id]','/api/collaborators/'+row.id,'PATCH',{version:row.version,...body},admin,status,{id:row.id})
const create=async(extra={},status=200)=>(await api('users','/api/users','POST',{name:'Partner login',email:randomUUID()+'@example.test',password,role:'STAFF',collaboratorId:collaborator.id,...extra},admin,status)).user
async function direct(user,sql,args=[],owner=false){const db=new Client({connectionString:owner?raw:url.toString()});await db.connect();try{await db.query('BEGIN');await db.query(`SELECT set_config('app.tenant_id',$1,true),set_config('app.actor_id',$2,true),set_config('app.rls_bypass','off',true)`,[tenant,user]);return await db.query(sql,args)}finally{await db.query('ROLLBACK');await db.end()}}
async function issue(extra={}){const result=await api('invites','/api/invites','POST',{email:randomUUID()+'@example.test',role:'STAFF',delivery:'LINK',collaboratorId:collaborator.id,...extra},admin,201);return{token:new URL(result.inviteUrl).searchParams.get('token')}}
const accept=(invite,status=200)=>api('invites/accept','/api/invites/accept','POST',{token:invite.token,name:'Invited partner',password},null,status)
before(async()=>{
 await root.connect();for(const id of [tenant,foreign])await root.query(`INSERT INTO "Tenant"(id,name,slug,"updatedAt") VALUES($1,$1,$1,now())`,[id])
 for(const [id,role] of [[admin,'ADMIN'],[manager,'MANAGER'],[internal,'STAFF']])await root.query(`INSERT INTO "User"(id,"tenantId",name,email,role,"updatedAt") VALUES($1,$2,$1,$1||'@example.test',$3,now())`,[id,tenant,role])
 for(const key of ['crm','shifts','leaves'])await root.query(`INSERT INTO "TenantModule"("tenantId",key,allowed,enabled,"updatedAt") VALUES($1,$2,true,true,now())`,[tenant,key])
 collaborator=await api('collaborators','/api/collaborators','POST',{name:'Agency partner',code:'PARTNER',supervisorUserId:manager},admin,201);second=await api('collaborators','/api/collaborators','POST',{name:'Another partner',code:'SECOND',supervisorUserId:admin},admin,201)
 broad=await api('access/roles','/api/access/roles','POST',{name:'Explicit business profile',permissions:allPermissions},admin,201)
 rules=defaultRecordRules();for(const key of allPermissions)if(key.startsWith('shift'))rules[key]='ALL'
 office='office_'+tenant
})
after(async()=>{await root.end();await Promise.all([prisma,global.prismaBypassClient,...[...(global.prismaScopedClientCache?.values()||[])].map(e=>e.client)].filter(Boolean).map(c=>c.$disconnect()));await global.prismaPool?.end()})

test('explicit external account creation links a distinct identity without employee profiles or inherited grants',async()=>{
 partner=await create();assert.equal(partner.collaboratorId,collaborator.id);assert.equal(partner.role,'STAFF');assert.equal(partner.staffProfile,null)
 assert.equal((await root.query(`SELECT count(*)::int n FROM "TenantRoleAssignment" WHERE "userId"=$1`,[partner.id])).rows[0].n,0)
 assert.equal((await root.query(`SELECT count(*)::int n FROM "BusinessOfficeGrant" WHERE "userId"=$1`,[partner.id])).rows[0].n,0)
 await api('crm/enquiries','/api/crm/enquiries','GET',undefined,partner.id,403)
 const linked=await create();const list=await api('collaborators/[id]/logins','/api/collaborators/'+collaborator.id+'/logins?pageSize=1','GET',undefined,admin,200,{id:collaborator.id});assert.equal(list.total,2);assert.equal(list.items.length,1);assert.ok(!Object.hasOwn(list.items[0],'passwordHash'));assert.notEqual(linked.id,partner.id)
 await api('collaborators/[id]/logins','/api/collaborators/'+collaborator.id+'/logins','GET',undefined,partner.id,403,{id:collaborator.id})
})
test('foreign, archived and management-role proposals fail; existing identities cannot be converted or relinked',async()=>{
 for(const role of ['ADMIN','MANAGER','CUSTOMER'])await create({role},400)
 await create({collaboratorId:'foreign_or_missing'},400);await create({eligibleServiceIds:[]},400)
 const row=await update(second,{archived:true});await create({collaboratorId:row.id},400);await update(row,{archived:false})
 for(const [id,value]of[[internal,collaborator.id],[partner.id,null],[partner.id,second.id]])await assert.rejects(root.query(`UPDATE "User" SET "collaboratorId"=$1 WHERE id=$2`,[value,id]),/identity is immutable/)
 await patch(partner.id,{role:'MANAGER'},400);await patch(partner.id,{role:'CUSTOMER'},400)
})
test('explicit business grants work while workforce, user directory and team administration remain outside external identity',async()=>{
 const access=await api('access/users/[id]','/api/access/users/'+partner.id,'GET',undefined,admin,200,{id:partner.id})
 await api('access/users/[id]','/api/access/users/'+partner.id,'PATCH',{version:access.accessPolicy.version,roleIds:[broad.id],rules},admin,200,{id:partner.id})
 const memberships=await api('access/users/[id]/offices','/api/access/users/'+partner.id+'/offices','GET',undefined,admin,200,{id:partner.id})
 await api('access/users/[id]/offices','/api/access/users/'+partner.id+'/offices','PATCH',{version:memberships.version,officeIds:[office],companies:[],creationOfficeId:office},admin,200,{id:partner.id})
 const modules=await api('modules','/api/modules','GET',undefined,partner.id);assert.ok(modules.permissions.includes('enquiries.read'));assert.ok(!modules.permissions.includes('users.read'));assert.ok(!modules.permissions.some(p=>p.startsWith('shift')||p.startsWith('leave')));assert.ok(!modules.permissions.includes('teamMembers.assign'))
 await api('crm/enquiries','/api/crm/enquiries','GET',undefined,partner.id)
 await api('users','/api/users','GET',undefined,partner.id,403);await api('shifts/workplaces','/api/shifts/workplaces?staffId='+internal,'GET',undefined,partner.id,403)
 await api('teams','/api/teams','POST',{name:'Denied external team'},partner.id,403)
 await assert.rejects(direct(partner.id,`SELECT app.workforce_capability($1,'shiftRoster.read')`,[tenant]),/permission denied/)
 const result=await direct(partner.id,`SELECT app.workforce_capability($1,'shiftRoster.read') shifts,app.workplace_capability($1,'shiftRoster.read') workplace,app.leave_capability($1,$2,'leaveRequests.read') leaves`,[tenant,partner.id],true);assert.deepEqual(result.rows[0],{shifts:false,workplace:false,leaves:false})
 assert.equal((await direct(partner.id,'SELECT * FROM "StaffProfile"')).rowCount,0)
})

test('private scheduling integrity cannot borrow disabled employee capabilities for an external login',async()=>{
 // Protected projections retain booking use only when current explicit booking
 // capability is present; a broad HR profile cannot supply it instead.
 for(const statement of ["SELECT app.require_booking_integrity_access($1)","SELECT app.require_working_time_access($1)","SELECT * FROM app.approved_leave_blocks($1,ARRAY[]::text[],DATE '2030-01-01',DATE '2030-01-02')"]){
  await assert.rejects(direct(partner.id,statement,[tenant],true),/not permitted/)
 }
 await root.query('INSERT INTO "TenantModule"("tenantId",key,allowed,enabled,"updatedAt") VALUES($1,\'appointments\',true,true,now())',[tenant])
 try{await direct(partner.id,'SELECT app.require_working_time_access($1)',[tenant],true)}finally{await root.query('UPDATE "TenantModule" SET enabled=false WHERE "tenantId"=$1 AND key=\'appointments\'',[tenant])}
})
test('employee profile, employee reporting, service and internal leadership cannot be attached through API or SQL',async()=>{
 await patch(partner.id,{staffProfile:{leaveApprovalMode:'TENANT_ADMIN'}},400);await patch(partner.id,{eligibleServiceIds:[]},400)
 await assert.rejects(root.query(`INSERT INTO "StaffProfile"(id,"userId","updatedAt") VALUES($1,$1,now())`,[partner.id]),/employee profiles/)
 await patch(internal,{staffProfile:{leaveApprovalMode:'TENANT_ADMIN'}},200)
 await patch(internal,{staffProfile:{managerUserId:partner.id}},400)
 await assert.rejects(root.query(`UPDATE "StaffProfile" SET "managerUserId"=$1 WHERE "userId"=$2`,[partner.id,internal]),/employee reporting/)
 const group=await api('teams','/api/teams','POST',{name:'Internal team'},admin,201)
 await assert.rejects(root.query(`INSERT INTO "BusinessTeamMember"("tenantId","teamId","userId","isManager") VALUES($1,$2,$3,true)`,[tenant,group.id,partner.id]),/manage internal teams/)
 assert.equal((await api('dashboard/summary','/api/dashboard/summary')).kpis.activeStaff,1)
})
test('external invitation acceptance uses the same identity and never creates employment or infers association by email',async()=>{
 invitation=await issue();await accept(invitation)
 const row=(await root.query(`SELECT "collaboratorId",id FROM "User" WHERE "tenantId"=$1 ORDER BY "createdAt" DESC LIMIT 1`,[tenant])).rows[0];assert.equal(row.collaboratorId,collaborator.id)
 assert.equal((await root.query(`SELECT count(*)::int n FROM "StaffProfile" WHERE "userId"=$1`,[row.id])).rows[0].n,0)
 await accept(invitation,400)
 const ordinary=await issue({collaboratorId:undefined,email:'ordinary-'+randomUUID()+'@example.test'});await accept(ordinary)
 const ordinaryId=(await root.query(`SELECT id FROM "User" WHERE "tenantId"=$1 AND email LIKE 'ordinary-%'`,[tenant])).rows[0].id;assert.equal((await root.query(`SELECT "collaboratorId" FROM "User" WHERE id=$1`,[ordinaryId])).rows[0].collaboratorId,null)
})

test('failed mandatory archive audit restores account statuses and pending invitation validity atomically',async()=>{
 const pending=await issue();const before=(await root.query('SELECT id,status FROM "User" WHERE "collaboratorId"=$1 ORDER BY id',[collaborator.id])).rows
 await root.query(`CREATE FUNCTION public.external_login_audit_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."tenantId"='${tenant}' AND NEW.event='collaborator.updated' AND NEW.after->>'archived'='true' THEN RAISE EXCEPTION 'Required external archive audit unavailable'; END IF; RETURN NEW; END $$`)
 await root.query('CREATE TRIGGER external_login_audit_failure BEFORE INSERT ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION public.external_login_audit_failure()')
 try{await update(collaborator,{archived:true},500)}finally{await root.query('DROP TRIGGER external_login_audit_failure ON "AuditLog"');await root.query('DROP FUNCTION public.external_login_audit_failure()')}
 assert.deepEqual((await root.query('SELECT id,status FROM "User" WHERE "collaboratorId"=$1 ORDER BY id',[collaborator.id])).rows,before)
 assert.equal((await api('collaborators/[id]','/api/collaborators/'+collaborator.id,'GET',undefined,admin,200,{id:collaborator.id})).archived,false)
 await accept(pending)
})
test('archive atomically suspends linked accounts and expires pending invitations; restoration never revives either',async()=>{
 const pending=await issue(),before=(await root.query(`SELECT count(*)::int n FROM "User" WHERE "collaboratorId"=$1 AND status='ACTIVE'`,[collaborator.id])).rows[0].n;assert.ok(before>=3)
 collaborator=await update(collaborator,{archived:true});assert.equal((await root.query(`SELECT count(*)::int n FROM "User" WHERE "collaboratorId"=$1 AND status='ACTIVE'`,[collaborator.id])).rows[0].n,0)
 await api('crm/enquiries','/api/crm/enquiries','GET',undefined,partner.id,403);await patch(partner.id,{status:'ACTIVE'},409);await create({},400);await accept(pending,400)
 assert.equal((await root.query(`SELECT count(*)::int n FROM "AuditLog" WHERE event='collaborator.login.suspended' AND metadata->>'collaboratorId'=$1`,[collaborator.id])).rows[0].n,before)
 collaborator=await update(collaborator,{archived:false});await api('crm/enquiries','/api/crm/enquiries','GET',undefined,partner.id,403);await accept(pending,400)
 await patch(partner.id,{status:'ACTIVE'});await api('crm/enquiries','/api/crm/enquiries','GET',undefined,partner.id)
})
test('changing supervisors does not change login access, office grants or stored identity',async()=>{
 const before=(await root.query(`SELECT "collaboratorId",role,status FROM "User" WHERE id=$1`,[partner.id])).rows[0]
 collaborator=await update(collaborator,{supervisorUserId:admin});assert.deepEqual((await root.query(`SELECT "collaboratorId",role,status FROM "User" WHERE id=$1`,[partner.id])).rows[0],before)
 await api('crm/enquiries','/api/crm/enquiries','GET',undefined,partner.id)
 const events=(await root.query(`SELECT before,after,metadata FROM "AuditLog" WHERE "tenantId"=$1 AND event LIKE 'collaborator.%'`,[tenant])).rows;assert.ok(!JSON.stringify(events).includes(password));assert.ok(!JSON.stringify(events).includes(invitation.token))
})

test('whole-tenant cleanup handles linked external identities without orphaning logins or changing another tenant',async()=>{
 const t='external_cleanup_'+randomUUID().replaceAll('-',''),owner=t+'_admin';await root.query('INSERT INTO "Tenant"(id,name,slug,"updatedAt") VALUES($1,$1,$1,now())',[t])
 await root.query(`INSERT INTO "User"(id,"tenantId",email,role,"updatedAt") VALUES($1,$2,$1||'@example.test','ADMIN',now())`,[owner,t])
 const c=await api('collaborators','/api/collaborators','POST',{name:'Disposable agency',code:'CLEANUP',supervisorUserId:owner},owner,201,{},t)
 const u=(await api('users','/api/users','POST',{email:randomUUID()+'@example.test',password,role:'STAFF',collaboratorId:c.id},owner,200,{},t)).user
 await root.query('BEGIN')
 try{for(const table of ['RealEstateProjectStatus','RealEstatePropertyCategory','RealEstateBuyingTimeframe'])await root.query(`DELETE FROM "${table}" WHERE "tenantId"=$1`,[t]);await root.query('DELETE FROM "Tenant" WHERE id=$1',[t]);await root.query('COMMIT')}catch(error){await root.query('ROLLBACK');throw error}
 assert.equal((await root.query('SELECT id FROM "User" WHERE id=$1',[u.id])).rowCount,0);assert.equal((await root.query('SELECT id FROM "ExternalCollaborator" WHERE id=$1',[c.id])).rowCount,0)
 assert.equal((await root.query('SELECT id FROM "User" WHERE id=$1',[partner.id])).rowCount,1)
})
