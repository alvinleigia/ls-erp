/* eslint-disable @typescript-eslint/no-require-imports */
const {test,before,after}=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto'),{AsyncLocalStorage}=require('node:async_hooks'),{Client}=require('pg')
const raw=process.env.CRM_TEST_DATABASE_URL,url=new URL(raw||'http://invalid');if(!['localhost','127.0.0.1'].includes(url.hostname)||url.pathname!='/ls_salon_crm_test')throw Error('Disposable local database only.')
const root=new Client({connectionString:raw}),sessions=new AsyncLocalStorage();url.username='crm_test_runtime';url.password='';process.env.DATABASE_URL=url.toString()
const authPath=require.resolve('../auth.ts');require.cache[authPath]={id:authPath,filename:authPath,loaded:true,exports:{auth:async()=>sessions.getStore()||null}}
const logger=require('../lib/logger.ts').logger;logger.info=()=>{};logger.error=()=>{}
const {prisma}=require('../lib/prisma.ts')
const tenant='external_ui_'+randomUUID().replaceAll('-',''),foreign=tenant+'_foreign',admin=tenant+'_admin',foreignAdmin=foreign+'_admin',password='SyntheticPartner!2026'
let a,b,partner,manager,business
async function api(module,path,method='GET',body,user=admin,status=200,params={},host=tenant){
 const response=await sessions.run({user:{id:user,tenantId:host,role:'ADMIN'}},()=>require('../app/api/'+module+'/route.ts')[method](new Request('http://'+host+'.localhost'+path,{method,headers:{host:host+'.localhost','Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})}),{params:Promise.resolve(params)}));const data=await response.json();assert.equal(response.status,status,path+': '+data.error);return data
}
const role=(name,permissions,extra={})=>api('access/roles','/api/access/roles','POST',{name,permissions,...extra},admin,201)
const patch=(id,body,status=200)=>api('users/[id]','/api/users/'+id,'PATCH',body,admin,status,{id})
const invite=(collaboratorId,email)=>api('invites','/api/invites','POST',{email,role:'STAFF',delivery:'LINK',collaboratorId},admin,201)
before(async()=>{
 await root.connect();for(const [t,u]of[[tenant,admin],[foreign,foreignAdmin]]){await root.query('INSERT INTO "Tenant"(id,name,slug,"updatedAt") VALUES($1,$1,$1,now())',[t]);await root.query(`INSERT INTO "User"(id,"tenantId",email,role,"updatedAt") VALUES($1,$2,$1||'@example.test','ADMIN',now())`,[u,t])}
 a=await api('collaborators','/api/collaborators','POST',{name:'UI partner A',code:'A',supervisorUserId:admin},admin,201);b=await api('collaborators','/api/collaborators','POST',{name:'UI partner B',code:'B',supervisorUserId:admin},admin,201)
 partner=(await api('users','/api/users','POST',{name:'Partner A login',email:randomUUID()+'@example.test',password,role:'STAFF',collaboratorId:a.id})).user
})
after(async()=>{await root.end();await Promise.all([prisma,global.prismaBypassClient,...[...(global.prismaScopedClientCache?.values()||[])].map(e=>e.client)].filter(Boolean).map(c=>c.$disconnect()));await global.prismaPool?.end()})

test('external profile choices use one tenant/eligible-action population for search, counts and page boundaries',async()=>{
 business=await role('UI Business Alpha',['dashboard.read','enquiries.read']);await role('UI Business Beta',['contacts.read']);await role('UI Mixed profile',['users.read','shiftRoster.read','enquiries.read']);await role('UI HR only',['shiftRoster.read','leaveRequests.read']);await role('UI Directory only',['users.read']);await role('UI Archived business',['enquiries.read'],{archived:true})
 await api('access/roles','/api/access/roles','POST',{name:'UI Foreign business',permissions:['enquiries.read']},foreignAdmin,201,{},foreign)
 const first=await api('access/roles','/api/access/roles?audience=external&q=UI&pageSize=2'),second=await api('access/roles','/api/access/roles?audience=external&q=UI&pageSize=2&page=2')
 assert.equal(first.total,3);assert.equal(first.totalPages,2);assert.equal(new Set([...first.items,...second.items].map(x=>x.id)).size,3)
 assert.equal((await api('access/roles','/api/access/roles?audience=external&q=HR')).total,0);assert.equal((await api('access/roles','/api/access/roles?audience=external&archived=true&q=UI')).total,1)
 assert.equal((await api('access/roles','/api/access/roles?q=UI')).total,5)
 await api('access/roles','/api/access/roles?audience=unknown','GET',undefined,admin,400)
})
test('assignment metadata identifies external accounts without granting directory access to them',async()=>{
 const row=await api('access/users/[id]','/api/access/users/'+partner.id,'GET',undefined,admin,200,{id:partner.id});assert.equal(row.collaboratorId,a.id)
 manager=(await api('users','/api/users','POST',{email:randomUUID()+'@example.test',password,role:'MANAGER',accessRoleIds:[business.id]})).user
 for(const user of [partner.id,manager.id])await api('access/roles','/api/access/roles?audience=external','GET',undefined,user,403)
})
test('status expectations reject stale lifecycle edits under the shared lock without altering identity or access',async()=>{
 await patch(partner.id,{status:'SUSPENDED',expectedStatus:'ACTIVE'})
 await patch(partner.id,{status:'ACTIVE',expectedStatus:'ACTIVE'},409)
 let row=(await root.query('SELECT status,"collaboratorId" FROM "User" WHERE id=$1',[partner.id])).rows[0];assert.equal(row.status,'SUSPENDED');assert.equal(row.collaboratorId,a.id)
 await patch(partner.id,{status:'ACTIVE',expectedStatus:'SUSPENDED'});await patch(partner.id,{status:'SUSPENDED',expectedStatus:'bogus'},400)
 row=(await root.query('SELECT status FROM "User" WHERE id=$1',[partner.id])).rows[0];assert.equal(row.status,'ACTIVE')
})
test('partner invitation filters preserve paging and search without exposing access proposals or other partners',async()=>{
 const email=randomUUID()+'@example.test';await invite(a.id,email);await invite(a.id,randomUUID()+'@example.test');await invite(b.id,randomUUID()+'@example.test')
 await api('invites','/api/invites','POST',{email:randomUUID()+'@example.test',role:'STAFF',delivery:'LINK'},admin,201)
 const first=await api('invites','/api/invites?collaboratorId='+a.id+'&status=pending&pageSize=1'),second=await api('invites','/api/invites?collaboratorId='+a.id+'&status=pending&pageSize=1&page=2')
 assert.equal(first.total,2);assert.equal(first.totalPages,2);assert.notEqual(first.items[0].id,second.items[0].id);assert.equal(first.items[0].collaboratorId,a.id);assert.equal(Object.hasOwn(first.items[0],'accessConfiguration'),false)
 assert.equal((await api('invites','/api/invites?collaboratorId='+a.id+'&q='+encodeURIComponent(email))).total,1)
 assert.equal((await api('invites','/api/invites?collaboratorId='+b.id)).total,1)
 await api('invites','/api/invites?collaboratorId='+a.id,'GET',undefined,partner.id,403)
})
