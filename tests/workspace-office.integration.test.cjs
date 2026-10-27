/* eslint-disable @typescript-eslint/no-require-imports */
const {test,before,after}=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto'),{Client}=require('pg'),{AsyncLocalStorage}=require('node:async_hooks')
const raw=process.env.CRM_TEST_DATABASE_URL,url=new URL(raw||'http://invalid');if(!['localhost','127.0.0.1'].includes(url.hostname)||url.pathname!='/ls_salon_crm_test')throw Error('Disposable local database only.')
const root=new Client({connectionString:raw}),sessions=new AsyncLocalStorage();url.username='crm_test_runtime';url.password='';process.env.DATABASE_URL=url.toString()
const authPath=require.resolve('../auth.ts');require.cache[authPath]={id:authPath,filename:authPath,loaded:true,exports:{auth:async()=>sessions.getStore()||null}}
const errors=[];require('../lib/logger.ts').logger.info=()=>{};require('../lib/logger.ts').logger.error=(_,c)=>errors.push(c.error?.message)
const {prisma}=require('../lib/prisma.ts'),listRoute=require('../app/api/workspace/offices/route.ts'),contextRoute=require('../app/api/workspace/office/route.ts'),membershipRoute=require('../app/api/access/users/[id]/offices/route.ts')
const t='workspace_'+randomUUID().replaceAll('-',''),other=t+'_other',id=n=>t+'_'+n,admin=id('admin'),staff=id('staff'),manager=id('manager'),customer=id('customer'),none=id('none'),parent=id('parent'),child=id('child'),a=id('a'),b=id('b'),outside=id('outside')
async function call(path,method='GET',body,user=staff,status=200){const response=await sessions.run(user?{user:{id:user,tenantId:t,role:'ADMIN'}}:null,()=> (path.startsWith('/api/workspace/offices')?listRoute:contextRoute)[method](new Request('http://'+t+'.localhost'+path,{method,headers:{host:t+'.localhost','Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})})));const data=await response.json();assert.equal(response.status,status,JSON.stringify({data,errors:errors.slice(-2)}));if(status===200)assert.equal(response.headers.get('cache-control'),'no-store');return data}
const context=(user=staff)=>call('/api/workspace/office','GET',undefined,user),choices=(query={},user=staff,status=200)=>call('/api/workspace/offices?'+new URLSearchParams(query),'GET',undefined,user,status)
const select=(officeId,version,user=staff,status=200)=>call('/api/workspace/office','PATCH',{officeId,version},user,status)
async function grants(officeIds,companies=[],creationOfficeId=null){const current=await context();const response=await sessions.run({user:{id:admin,tenantId:t,role:'ADMIN'}},()=>membershipRoute.PATCH(new Request('http://'+t+'.localhost/api/access/users/'+staff+'/offices',{method:'PATCH',headers:{host:t+'.localhost','Content-Type':'application/json'},body:JSON.stringify({version:current.version,officeIds,companies,creationOfficeId})}),{params:Promise.resolve({id:staff})}));assert.equal(response.status,200,JSON.stringify(await response.clone().json()));return response.json()}
async function unchanged(){const out={};for(const table of ['BusinessOfficeGrant','BusinessCompanyGrant','TenantRoleAssignment','TenantUserAccess','StaffWorkplaceAssignment'])out[table]=(await root.query('SELECT row_to_json(x) row FROM "'+table+'" x WHERE "tenantId"=$1 ORDER BY row_to_json(x)::text',[t])).rows;return out}
before(async()=>{
 await root.connect();for(const tenant of [t,other])await root.query('INSERT INTO "Tenant"(id,name,slug,"updatedAt") VALUES($1,$1,$1,now())',[tenant])
 for(const [user,role]of[[admin,'ADMIN'],[staff,'STAFF'],[manager,'MANAGER'],[customer,'CUSTOMER'],[none,'STAFF']])await root.query(`INSERT INTO "User"(id,"tenantId",name,email,role,"updatedAt") VALUES($1,$2,$1,$1||'@example.test',$3,now())`,[user,t,role])
 for(const [company,up]of[[parent,null],[child,parent]])await root.query('INSERT INTO "BusinessCompany"(id,"tenantId",name,code,"parentId","updatedAt") VALUES($1,$2,$1,$3,$4,now())',[company,t,company===parent?'PARENT':'CHILD',up])
 for(const [office,company,code]of[[a,parent,'EAST'],[b,child,'WEST'],[outside,null,'OUTSIDE']])await root.query('INSERT INTO "BusinessOffice"(id,"tenantId","companyId",name,code,"updatedAt") SELECT $1,$2,COALESCE($3,"companyId"),$4,$4,now() FROM "BusinessOffice" WHERE "tenantId"=$2 AND "isInitial"',[office,t,company,code])
 for(let i=0;i<24;i++)await root.query('INSERT INTO "BusinessOffice"(id,"tenantId","companyId",name,code,"updatedAt") VALUES($1,$2,$3,$4,$5,now())',[id('page_'+i),t,parent,'Page office '+String(i).padStart(2,'0'),'PAGE_'+i])
 await root.query('INSERT INTO "StaffProfile"(id,"userId","managerUserId","updatedAt") VALUES($1,$2,$3,now())',[id('profile'),staff,manager]);await root.query('INSERT INTO "StaffWorkplacePolicy"("tenantId","staffProfileId",version,"updatedAt") VALUES($1,$2,1,now())',[t,id('profile')]);await root.query('INSERT INTO "StaffWorkplaceAssignment"(id,"tenantId","staffProfileId","officeId","updatedAt") VALUES($1,$2,$3,$4,now())',[id('placement'),t,id('profile'),a])
 await root.query(`INSERT INTO "TenantAccessRole"(id,"tenantId",name,"nameKey",permissions,"updatedAt") VALUES($1,$2,'Workspace checks','workspace checks',ARRAY['users.read'],now())`,[id('role'),t]);await root.query('INSERT INTO "TenantRoleAssignment"("tenantId","userId","roleId","updatedAt") VALUES($1,$2,$3,now())',[t,staff,id('role')])
 await grants([], [{companyId:parent,includeSubsidiaries:true}],a)
})
after(async()=>{await root.end();await Promise.all([prisma,global.prismaBypassClient,...[...(global.prismaScopedClientCache?.values()||[])].map(e=>e.client)].filter(Boolean).map(c=>c.$disconnect()));await global.prismaPool?.end()})

test('self choices share native eligibility across counts, pages, search and off-page selected labels',async()=>{
 const first=await choices({pageSize:'2',selected:b}),second=await choices({pageSize:'2',page:'2',selected:b})
 assert.equal(first.total,26);assert.equal(first.totalPages,13);assert.equal(first.selected.id,b);assert.equal(second.selected.id,b);assert.equal(new Set([...first.items,...second.items].map(o=>o.id)).size,4)
 const filtered=await choices({q:'Page office 23',selected:b});assert.equal(filtered.total,1);assert.equal(filtered.selected.id,b)
 assert.equal((await choices({q:"' OR true --"})).total,0);assert.equal((await choices({page:'100'})).items.length,0)
 assert.equal((await choices({selected:outside})).selected,null)
 const foreign=(await root.query('SELECT id FROM "BusinessOffice" WHERE "tenantId"=$1',[other])).rows[0].id;assert.equal((await choices({selected:foreign})).selected,null)
})
test('selection updates only the persisted self preference/version and mandatory audit',async()=>{
 const before=await unchanged(),old=await context(),saved=await select(b,old.version)
 assert.equal(saved.version,old.version+1);assert.equal((await context()).creationOffice.id,b);assert.equal((await context()).creationOfficeId,b);assert.deepEqual(await unchanged(),before)
 const audit=(await root.query(`SELECT "after" FROM "AuditLog" WHERE "tenantId"=$1 AND "actorUserId"=$2 AND event='workspace.creationOffice.updated' AND ("after"->>'version')::int=$3`,[t,staff,saved.version])).rows;assert.equal(audit.length,1);assert.equal(audit[0].after.creationOfficeId,b)
})
test('concurrent preference versions conflict, preserve the winner and never alter grants',async()=>{
 const before=await unchanged(),old=await context(),winner=await select(a,old.version)
 await select(b,old.version,staff,409);assert.equal((await context()).version,winner.version);assert.equal((await context()).creationOffice.id,a);assert.deepEqual(await unchanged(),before)
})
test('explicit clearing has no fallback and unassigned users acquire no membership from choosing none',async()=>{
 const before=await unchanged(),old=await context();await select(null,old.version)
 assert.deepEqual(await context(),{creationOffice:null,creationOfficeId:null,version:old.version+1});assert.equal((await choices()).total,26)
 assert.deepEqual(await context(none),{creationOffice:null,creationOfficeId:null,version:0});assert.equal((await choices({},none)).total,0)
 await select(null,0,none);assert.equal((await choices({},none)).total,0);assert.deepEqual(await unchanged(),before)
})
test('closed or revoked preferences stay identifiable for explicit clearing without exposing active labels',async()=>{
 const old=await context();await select(b,old.version);await root.query('UPDATE "BusinessOffice" SET archived=true WHERE id=$1',[b])
 try{const current=await context();assert.equal(current.creationOffice,null);assert.equal(current.creationOfficeId,b);assert.equal((await choices({selected:b})).selected,null);assert.equal((await choices()).total,25);await select(b,current.version,staff,403);await select(null,current.version);assert.equal((await context()).creationOfficeId,null)}finally{await root.query('UPDATE "BusinessOffice" SET archived=false WHERE id=$1',[b])}
 const saved=await grants([a],[],a);assert.equal((await choices({selected:b})).selected,null);await select(b,saved.version,staff,403);assert.equal((await context()).creationOfficeId,a)
})
test('self lookup never delegates directory or action permissions; forged targets and unbounded queries fail',async()=>{
 assert.equal((await choices({},manager)).total,0);assert.ok((await choices({},admin)).total>1)
 for(const query of [{userId:admin},{tenantId:other},{pageSize:'101'},{q:'a'.repeat(161)},{page:'0'},{sort:'tenantId'},{selected:'a'.repeat(201)}])await choices(query,staff,400)
 for(const extra of [{userId:admin},{tenantId:other},{role:'ADMIN'}])await call('/api/workspace/office','PATCH',{officeId:a,version:(await context()).version,...extra},staff,400)
 const response=await sessions.run({user:{id:staff,tenantId:t,role:'ADMIN'}},()=>require('../app/api/offices/route.ts').GET(new Request('http://'+t+'.localhost/api/offices',{headers:{host:t+'.localhost'}})));assert.equal(response.status,403)
})
test('fresh account/tenant revocation and customer identities deny self selectors',async()=>{
 await choices({},customer,403);await choices({},null,401)
 await root.query(`UPDATE "User" SET status='SUSPENDED' WHERE id=$1`,[staff]);try{await choices({},staff,403);await select(null,0,staff,403)}finally{await root.query(`UPDATE "User" SET status='ACTIVE' WHERE id=$1`,[staff])}
 await root.query(`UPDATE "Tenant" SET status='SUSPENDED' WHERE id=$1`,[t]);try{await choices({},staff,404)}finally{await root.query(`UPDATE "Tenant" SET status='ACTIVE' WHERE id=$1`,[t])}
})
