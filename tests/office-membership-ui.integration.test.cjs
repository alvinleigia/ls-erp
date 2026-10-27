/* eslint-disable @typescript-eslint/no-require-imports */
const {test,before,after}=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto'),{Client}=require('pg'),{AsyncLocalStorage}=require('node:async_hooks')
const raw=process.env.CRM_TEST_DATABASE_URL,url=new URL(raw||'http://invalid')
if(!['localhost','127.0.0.1'].includes(url.hostname)||url.pathname!='/ls_salon_crm_test')throw Error('Disposable local database only.')
const root=new Client({connectionString:raw}),sessions=new AsyncLocalStorage();url.username='crm_test_runtime';url.password='';process.env.DATABASE_URL=url.toString()
const authPath=require.resolve('../auth.ts');require.cache[authPath]={id:authPath,filename:authPath,loaded:true,exports:{auth:async()=>sessions.getStore()||null}}
const errors=[];require('../lib/logger.ts').logger.info=()=>{};require('../lib/logger.ts').logger.error=(_,c)=>errors.push(c.error?.message)
const {prisma}=require('../lib/prisma.ts')
const initialPreview=require('../app/api/access/initial-office-choices/route.ts')
const preview=require('../app/api/access/users/[id]/offices/creation-choices/route.ts'),membership=require('../app/api/access/users/[id]/offices/route.ts')
const t='membership_ui_'+randomUUID().replaceAll('-',''),other=t+'_foreign',id=n=>t+'_'+n,admin=id('admin'),staff=id('staff'),manager=id('manager'),customer=id('customer'),parent=id('parent'),child=id('child'),grandchild=id('grandchild'),sibling=id('sibling'),closedCompany=id('closed_company'),closed=id('closed'),a=id('a'),b=id('b'),c=id('c'),d=id('d')
const base={officeIds:[],companies:[],selected:null},grant=(companyId,includeSubsidiaries=false)=>({companyId,includeSubsidiaries})
async function request(method,body,user=admin,target=staff,status=200,choices=true){
 const path='/api/access/users/'+target+'/offices'+(choices?'/creation-choices':'')
 const response=await sessions.run(user?{user:{id:user,tenantId:t,role:'ADMIN'}}:null,()=> (choices?preview:membership)[method](new Request('http://'+t+'.localhost'+path,{method,headers:{host:t+'.localhost','Content-Type':'application/json'},...(method==='GET'?{}:{body:typeof body==='string'?body:JSON.stringify(body)})}),{params:Promise.resolve({id:target})}))
 const data=await response.json();assert.equal(response.status,status,JSON.stringify({data,errors:errors.slice(-2)}));if(status===200)assert.equal(response.headers.get('cache-control'),'no-store');return data
}
const choices=(body={},user=admin,target=staff,status=200)=>request('POST',{...base,...body},user,target,status)
const get=()=>request('GET',undefined,admin,staff,200,false)
const save=async data=>request('PATCH',{version:(await get()).version,officeIds:[],companies:[],creationOfficeId:null,...data},admin,staff,200,false)
async function snapshot(){const output={};for(const table of ['BusinessOfficePolicy','BusinessOfficeGrant','BusinessCompanyGrant','TenantRoleAssignment','TenantUserAccess','StaffProfile','StaffWorkplaceAssignment','AuditLog'])output[table]=(await root.query('SELECT row_to_json(x) row FROM "'+table+'" x WHERE '+(table==='StaffProfile'?'"userId" IN (SELECT id FROM "User" WHERE "tenantId"=$1)':'"tenantId"=$1')+' ORDER BY row_to_json(x)::text',[t])).rows;return output}
before(async()=>{
 await root.connect();for(const tenant of [t,other])await root.query(`INSERT INTO "Tenant"(id,name,slug,"updatedAt") VALUES($1,$1,$1,now())`,[tenant])
 for(const [user,role]of[[admin,'ADMIN'],[staff,'STAFF'],[manager,'MANAGER'],[customer,'CUSTOMER']])await root.query(`INSERT INTO "User"(id,"tenantId",name,email,role,"updatedAt") VALUES($1,$2,$1,$1||'@example.test',$3,now())`,[user,t,role])
 for(const [company,up]of[[parent,null],[child,parent],[grandchild,child],[sibling,null],[closedCompany,null]])await root.query(`INSERT INTO "BusinessCompany"(id,"tenantId",name,code,"parentId","updatedAt") VALUES($1,$2,$1,upper(right($1,20)),$3,now())`,[company,t,up])
 for(const [office,company]of[[a,parent],[b,child],[c,grandchild],[d,sibling],[closed,closedCompany]])await root.query(`INSERT INTO "BusinessOffice"(id,"tenantId","companyId",name,code,"updatedAt") VALUES($1,$2,$3,$1,upper(right($1,20)),now())`,[office,t,company])
 await root.query(`INSERT INTO "StaffProfile"(id,"userId","managerUserId","updatedAt") VALUES($1,$2,$3,now())`,[id('profile'),staff,manager])
 await root.query(`INSERT INTO "StaffWorkplacePolicy"("tenantId","staffProfileId",version,"updatedAt") VALUES($1,$2,1,now())`,[t,id('profile')])
 await root.query(`INSERT INTO "StaffWorkplaceAssignment"(id,"tenantId","staffProfileId","officeId","updatedAt") VALUES($1,$2,$3,$4,now())`,[id('workplace'),t,id('profile'),a])
 await root.query(`INSERT INTO "TenantAccessRole"(id,"tenantId",name,"nameKey",permissions,"updatedAt") VALUES($1,$2,'Read users','read users',ARRAY['users.read'],now())`,[id('permission_profile'),t])
 await root.query(`INSERT INTO "TenantRoleAssignment"("tenantId","userId","roleId","updatedAt") VALUES($1,$2,$3,now())`,[t,staff,id('permission_profile')])
 for(let i=0;i<24;i++)await root.query(`INSERT INTO "BusinessOffice"(id,"tenantId","companyId",name,code,"updatedAt") VALUES($1,$2,$3,$4,$5,now())`,[id('page_'+i),t,parent,'Page office '+String(i).padStart(2,'0'),'PAGE_'+i])
})
after(async()=>{await root.end();await Promise.all([prisma,global.prismaBypassClient,...[...(global.prismaScopedClientCache?.values()||[])].map(e=>e.client)].filter(Boolean).map(c=>c.$disconnect()));await global.prismaPool?.end()})

test('draft choices have no fallback and use proposed grants rather than saved membership',async()=>{
 assert.equal((await choices()).total,0)
 await save({officeIds:[d],creationOfficeId:d})
 assert.deepEqual((await choices({officeIds:[a]})).items.map(x=>x.id),[a]);assert.equal((await get()).creationOfficeId,d)
 assert.equal((await choices()).total,0)
})
test('company grants, explicit subsidiary coverage and future offices share exact eligibility',async()=>{
 assert.equal((await choices({companies:[grant(parent)]})).total,25)
 const covered=await choices({companies:[grant(parent,true)],pageSize:100});assert.equal(covered.total,27);assert.ok(covered.items.some(x=>x.id===c));assert.ok(!covered.items.some(x=>x.id===d))
 await root.query(`INSERT INTO "BusinessOffice"(id,"tenantId","companyId",name,code,"updatedAt") VALUES($1,$2,$3,'Future office','FUTURE',now())`,[id('future'),t,grandchild])
 assert.equal((await choices({companies:[grant(parent,true)]})).total,28)
 assert.equal((await choices({companies:[grant(child)]})).total,1)
 assert.equal((await choices({companies:[grant(grandchild,true)]})).total,2)
})
test('paging, search and selected resolution use one scope, including off-page selections',async()=>{
 const draft={companies:[grant(parent,true)],pageSize:3,selected:c},first=await choices(draft),second=await choices({...draft,page:2})
 assert.equal(first.total,28);assert.equal(first.totalPages,10);assert.equal(first.selected.id,c);assert.equal(second.selected.id,c);assert.equal(new Set([...first.items,...second.items].map(x=>x.id)).size,6)
 const search=await choices({...draft,q:'Page office 23'});assert.equal(search.total,1);assert.equal(search.items[0].name,'Page office 23');assert.equal(search.selected.id,c)
 assert.equal((await choices({...draft,q:"' OR true --"})).total,0)
 assert.equal((await choices({...draft,page:100})).total,28);assert.equal((await choices({...draft,page:100})).items.length,0)
 assert.equal((await choices({...draft,selected:d})).selected,null)
})
test('closed history captions survive while creation choices exclude closed offices and companies',async()=>{
 await save({officeIds:[closed],creationOfficeId:closed})
 await root.query(`UPDATE "BusinessOffice" SET archived=true WHERE id=$1`,[closed]);await root.query(`UPDATE "BusinessCompany" SET archived=true WHERE id=$1`,[closedCompany])
 const saved=await get();assert.equal(saved.offices[0].office.company.id,closedCompany);assert.equal(saved.creationOffice.archived,true);assert.equal(saved.creationOffice.company.archived,true)
 assert.equal((await choices({officeIds:[closed],selected:closed})).selected,null);assert.equal((await choices({companies:[grant(closedCompany)]})).total,0)
 const before=await snapshot();await request('PATCH',{version:saved.version,officeIds:[closed],companies:[],creationOfficeId:closed},admin,staff,400,false);assert.deepEqual(await snapshot(),before)
 await save({officeIds:[closed]});assert.equal((await get()).creationOfficeId,null)
})
test('target administrators retain oversight; manager and staff labels add no offices',async()=>{
 const all=await choices({},admin,admin);assert.ok(all.items.length>0);assert.ok(all.total>=29)
 assert.equal((await choices({},admin,manager)).total,0);assert.equal((await choices({},admin,customer)).total,0)
 await choices({officeIds:[a]},admin,customer,400)
 await root.query(`UPDATE "User" SET status='SUSPENDED' WHERE id=$1`,[manager]);try{assert.equal((await choices({},admin,manager)).total,0);await choices({officeIds:[a]},admin,manager,400)}finally{await root.query(`UPDATE "User" SET status='ACTIVE' WHERE id=$1`,[manager])}
})
test('lookup is read-only and foreign IDs, malformed payloads and forged authority fail closed',async()=>{
 const foreign=(await root.query(`SELECT id,"companyId" FROM "BusinessOffice" WHERE "tenantId"=$1`,[other])).rows[0],before=await snapshot()
 await choices({companies:[grant(parent,true)],selected:c});assert.deepEqual(await snapshot(),before)
 assert.equal((await choices({officeIds:[a],selected:foreign.id})).selected,null)
 await choices({officeIds:[foreign.id]},admin,staff,400);await choices({companies:[grant(foreign.companyId)]},admin,staff,400)
 await choices({},admin,'missing_user',404);await choices({officeIds:[a,a]},admin,staff,400);await choices({companies:[grant(parent),grant(parent)]},admin,staff,400)
 for(const payload of [{role:'ADMIN'},{tenantId:other},{officeIds:Array(201).fill(a)},{pageSize:101},{q:'a'.repeat(161)},{companies:[{companyId:parent,includeSubsidiaries:true,role:'ADMIN'}]}])await choices(payload,admin,staff,400)
 await request('POST','{invalid',admin,staff,400);assert.deepEqual(await snapshot(),before)
})
test('fresh authorization ignores stale admin sessions and tenant suspension',async()=>{
 for(const user of [manager,staff,customer])await choices({},user,staff,403)
 await choices({},null,staff,401)
 await root.query(`UPDATE "User" SET role='MANAGER' WHERE id=$1`,[admin]);try{await choices({},admin,staff,403)}finally{await root.query(`UPDATE "User" SET role='ADMIN' WHERE id=$1`,[admin])}
 await root.query(`UPDATE "Tenant" SET status='SUSPENDED' WHERE id=$1`,[t]);try{await choices({},admin,staff,404)}finally{await root.query(`UPDATE "Tenant" SET status='ACTIVE' WHERE id=$1`,[t])}
})
test('hierarchy changes refresh choices and a preview never authorizes a stale save',async()=>{
 assert.ok((await choices({companies:[grant(parent,true)],selected:b})).selected)
 await root.query(`UPDATE "BusinessCompany" SET "parentId"=$1 WHERE id=$2`,[sibling,child]);try{const result=await choices({companies:[grant(parent,true)],selected:b});assert.equal(result.selected,null);assert.equal(result.total,25)}finally{await root.query(`UPDATE "BusinessCompany" SET "parentId"=$1 WHERE id=$2`,[parent,child])}
 const saved=await save({officeIds:[a],creationOfficeId:a});await choices({officeIds:[b],selected:b});await save({officeIds:[d],creationOfficeId:d})
 const before=await snapshot();await request('PATCH',{version:saved.version,officeIds:[b],companies:[],creationOfficeId:b},admin,staff,409,false);assert.deepEqual(await snapshot(),before)
})

async function initial(body={},user=admin,status=200){
 const input={role:'STAFF',status:'ACTIVE',...base,...body}
 const response=await sessions.run(user?{user:{id:user,tenantId:t,role:'ADMIN'}}:null,()=>initialPreview.POST(new Request('http://'+t+'.localhost/api/access/initial-office-choices',{method:'POST',headers:{host:t+'.localhost','Content-Type':'application/json'},body:JSON.stringify(input)})))
 const data=await response.json();assert.equal(response.status,status,JSON.stringify({data,errors:errors.slice(-2)}));if(status===200)assert.equal(response.headers.get('cache-control'),'no-store');return data
}
test('new-account previews use the same exact/company/subsidiary population without saving an identity',async()=>{
 const before=await snapshot(),users=(await root.query('SELECT id FROM "User" WHERE "tenantId"=$1 ORDER BY id',[t])).rows
 assert.equal((await initial()).total,0)
 assert.deepEqual((await initial({officeIds:[a],selected:a})).items.map(x=>x.id),[a])
 const draft={companies:[grant(parent,true)],pageSize:2,q:'Page office',selected:b},newAccount=await initial(draft),existing=await choices(draft)
 assert.deepEqual(newAccount,existing);assert.equal(newAccount.selected.id,b)
 assert.equal((await initial({companies:[grant(parent)],selected:b})).selected,null)
 assert.deepEqual(await snapshot(),before);assert.deepEqual((await root.query('SELECT id FROM "User" WHERE "tenantId"=$1 ORDER BY id',[t])).rows,users)
})
test('new-account role/status changes constrain choices and never borrow creator oversight',async()=>{
 assert.equal((await initial({role:'ADMIN'})).total,(await choices({},admin,admin)).total)
 for(const role of ['STAFF','MANAGER','CUSTOMER'])assert.equal((await initial({role})).total,0)
 await initial({role:'CUSTOMER',officeIds:[a]},admin,400)
 for(const status of ['SUSPENDED','INVITED','ARCHIVED']){assert.equal((await initial({status})).total,0);await initial({status,officeIds:[a]},admin,400)}
 assert.equal((await initial({officeIds:[closed],selected:closed})).selected,null)
})
test('initial preview rejects foreign grants, duplicates, authority fields and unsupported roles/status',async()=>{
 const foreign=(await root.query('SELECT id,"companyId" FROM "BusinessOffice" WHERE "tenantId"=$1',[other])).rows[0]
 for(const body of [{officeIds:[foreign.id]},{companies:[grant(foreign.companyId)]},{officeIds:[a,a]},{companies:[grant(parent),grant(parent)]},{tenantId:other},{userId:staff},{version:1},{role:'SUPER_ADMIN'},{status:'PENDING'},{pageSize:101},{officeIds:Array(201).fill(a)},{q:'a'.repeat(161)}])await initial(body,admin,400)
 assert.equal((await initial({officeIds:[a],selected:foreign.id})).selected,null)
})
test('initial preview requires fresh tenant-admin authority even with proposed ADMIN role',async()=>{
 const before=await snapshot()
 for(const user of [staff,manager,customer])await initial({role:'ADMIN'},user,403)
 await initial({},null,401)
 await root.query(`UPDATE "User" SET role='MANAGER' WHERE id=$1`,[admin]);try{await initial({role:'ADMIN'},admin,403)}finally{await root.query(`UPDATE "User" SET role='ADMIN' WHERE id=$1`,[admin])}
 assert.deepEqual(await snapshot(),before)
})
