/* eslint-disable @typescript-eslint/no-require-imports */
const {test,before,after}=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto'),{Client}=require('pg'),{AsyncLocalStorage}=require('node:async_hooks')
const raw=process.env.CRM_TEST_DATABASE_URL,url=new URL(raw||'http://invalid');if(!['localhost','127.0.0.1'].includes(url.hostname)||url.pathname!='/ls_salon_crm_test')throw Error('Disposable local database only.')
const root=new Client({connectionString:raw}),sessions=new AsyncLocalStorage();url.username='crm_test_runtime';url.password='';process.env.DATABASE_URL=url.toString()
const authPath=require.resolve('../auth.ts');require.cache[authPath]={id:authPath,filename:authPath,loaded:true,exports:{auth:async()=>sessions.getStore()||null}}
const errors=[];require('../lib/logger.ts').logger.info=()=>{};require('../lib/logger.ts').logger.error=(_,c)=>errors.push(c.error?.message)
const {prisma}=require('../lib/prisma.ts'),{defaultRecordRules}=require('../platform/access/rules.ts')
const t='acceptance_'+randomUUID().replaceAll('-',''),admin=t+'_admin',password='IsolatedAcceptance!2026'
let parent,child,other,a,b,c,manager,workerA,workerB,workerC,teamA,teamB,teamC,profile,rules,leadA,leadB,leadC,contact
async function api(module,path,method='GET',body,user=admin,status=200,params={}){
 const headers={host:t+'.localhost','Content-Type':'application/json'}
 if(method==='POST'&&path==='/api/crm/enquiries'){const context=await api('workspace/office','/api/workspace/office','GET',undefined,user);if(context.creationOffice){headers['x-office-id']=context.creationOffice.id;headers['x-office-version']=String(context.version)}}
 const response=await sessions.run({user:{id:user,tenantId:t,role:'ADMIN'}},()=>require('../app/api/'+module+'/route.ts')[method](new Request('http://'+t+'.localhost'+path,{method,headers,...(body===undefined?{}:{body:JSON.stringify(body)})}),{params:Promise.resolve(params)}))
 const data=await response.json();assert.equal(response.status,status,JSON.stringify({path,data,errors:errors.slice(-2)}));return data
}
const current=user=>api('workspace/office','/api/workspace/office','GET',undefined,user)
async function select(user,officeId){const p=await current(user);return api('workspace/office','/api/workspace/office','PATCH',{version:p.version,officeId},user)}
const memberPath=user=>'/api/access/users/'+user+'/offices'
const membership=user=>api('access/users/[id]/offices',memberPath(user),'GET',undefined,admin,200,{id:user})
async function offices(user,officeIds,companies=[],creationOfficeId=null){const p=await membership(user);return api('access/users/[id]/offices',memberPath(user),'PATCH',{version:p.version,officeIds,companies,creationOfficeId},admin,200,{id:user})}
async function create(role,name,officeIds,accessRoleIds=[]){return (await api('users','/api/users','POST',{name,email:name.toLowerCase()+'-'+randomUUID()+'@example.test',role,password,accessRoleIds,recordRules:rules,officeAccess:{officeIds,companies:[],creationOfficeId:officeIds[0]||null}})).user}
async function team(name){return api('teams','/api/teams','POST',{name},admin,201)}
async function teamMember(team,user,isManager=false){const current=await api('teams/[id]','/api/teams/'+team.id,'GET',undefined,admin,200,{id:team.id});return api('teams/[id]/members','/api/teams/'+team.id+'/members','POST',{userId:user.id,isManager,version:current.version},admin,200,{id:team.id})}
async function lead(office,user,team,title){await select(admin,office.id);return api('crm/enquiries','/api/crm/enquiries','POST',{title,contactId:contact.id,assignedUserId:user.id,salesTeamId:team.id},admin,201)}
const read=(lead,status=200,user=manager.id)=>api('crm/enquiries/[id]','/api/crm/enquiries/'+lead.id,'GET',undefined,user,status,{id:lead.id})
const listing=(user=manager.id)=>api('crm/enquiries','/api/crm/enquiries','GET',undefined,user)
async function sharing(restricted,grants=[]){const path='/api/access/records/enquiries/'+leadB.id,params={resource:'enquiries',id:leadB.id},p=await api('access/records/[resource]/[id]',path,'GET',undefined,admin,200,params);return api('access/records/[resource]/[id]',path,'PATCH',{version:p.version,restricted,grants},admin,200,params)}
async function employment(){return (await root.query('SELECT row_to_json(x) row FROM "StaffProfile" x WHERE "userId"=$1',[workerA.id])).rows}
before(async()=>{
 await root.connect();await root.query('INSERT INTO "Tenant"(id,name,slug,"updatedAt") VALUES($1,$1,$1,now())',[t]);await root.query(`INSERT INTO "User"(id,"tenantId",email,role,"updatedAt") VALUES($1,$2,$1||'@example.test','ADMIN',now())`,[admin,t])
 for(const key of ['crm','shifts'])await root.query('INSERT INTO "TenantModule"("tenantId",key,allowed,enabled,"updatedAt") VALUES($1,$2,true,true,now())',[t,key])
 parent=await api('companies','/api/companies','POST',{name:'Parent operating company',code:'PARENT'},admin,201);child=await api('companies','/api/companies','POST',{name:'Regional subsidiary',code:'REGION',parentId:parent.id},admin,201);other=await api('companies','/api/companies','POST',{name:'Unrelated company',code:'OTHER'},admin,201)
 a=await api('offices','/api/offices','POST',{name:'Head office',code:'HEAD',companyId:parent.id},admin,201);b=await api('offices','/api/offices','POST',{name:'Regional office',code:'REGION',companyId:child.id},admin,201);c=await api('offices','/api/offices','POST',{name:'Other office',code:'OTHER',companyId:other.id},admin,201)
 profile=await api('access/roles','/api/access/roles','POST',{name:'Multi-team reader',permissions:['enquiries.read','contacts.read','teams.read','teamMembers.read','shiftRoster.read']},admin,201)
 rules=defaultRecordRules();for(const p of ['enquiries.read','enquiries.edit','teams.read','teamMembers.read'])rules[p]='MANAGED_TEAMS';rules['contacts.read']='MANAGED_TEAMS'
 manager=await create('MANAGER','RegionalManager',[a.id],[profile.id]);workerA=await create('STAFF','HeadStaff',[a.id]);workerB=await create('STAFF','RegionalStaff',[b.id]);workerC=await create('STAFF','OtherStaff',[c.id])
 teamA=await team('Head team');teamB=await team('Regional team');teamC=await team('Other team')
 for(const [group,user]of[[teamA,workerA],[teamB,workerB],[teamC,workerC]])await teamMember(group,user)
 await teamMember(teamA,manager,true);await teamMember(teamB,manager,true)
 contact=await api('crm/contacts','/api/crm/contacts','POST',{name:'Acceptance customer'},admin,201)
 leadA=await lead(a,workerA,teamA,'Head team lead');leadB=await lead(b,workerB,teamB,'Regional team lead');leadC=await lead(c,workerC,teamC,'Unrelated lead')
})
after(async()=>{await root.end();await Promise.all([prisma,global.prismaBypassClient,...[...(global.prismaScopedClientCache?.values()||[])].map(e=>e.client)].filter(Boolean).map(c=>c.$disconnect()));await global.prismaPool?.end()})

test('onboarding persists explicit offices and profiles without inventing workplace placement',async()=>{
 assert.deepEqual((await membership(manager.id)).offices.map(x=>x.officeId),[a.id]);assert.equal((await current(manager.id)).creationOffice.id,a.id)
 assert.equal((await root.query('SELECT count(*)::int n FROM "StaffWorkplaceAssignment" w JOIN "StaffProfile" p ON p.id=w."staffProfileId" WHERE p."userId"=$1',[workerA.id])).rows[0].n,0)
 assert.equal((await root.query('SELECT count(*)::int n FROM "TenantRoleAssignment" WHERE "userId"=$1',[workerA.id])).rows[0].n,0)
})
test('managing multiple teams never supplies missing office eligibility or an edit action',async()=>{
 assert.equal((await listing()).total,1);await read(leadA);await read(leadB,404);await read(leadC,404)
 await api('crm/enquiries/[id]','/api/crm/enquiries/'+leadA.id,'PATCH',{title:'Unauthorized edit',assignedUserId:workerA.id,status:'NEW',version:leadA.version},manager.id,403,{id:leadA.id})
 await api('shifts/workplaces','/api/shifts/workplaces','POST',{action:'assign',staffId:workerA.id,officeId:a.id,version:0,startsOn:'2030-01-01'},manager.id,403)
})
test('explicit company descendant grants combine with team authority rather than replacing it',async()=>{
 await offices(manager.id,[c.id],[{companyId:parent.id,includeSubsidiaries:false}],a.id);await read(leadB,404);await read(leadC,404)
 await offices(manager.id,[c.id],[{companyId:parent.id,includeSubsidiaries:true}],a.id);assert.equal((await listing()).total,2);await read(leadB);await read(leadC,404)
 const before=await listing(),grants=await membership(manager.id);await select(manager.id,b.id);await select(manager.id,null);assert.equal((await listing()).total,before.total);assert.deepEqual((await membership(manager.id)).companies,grants.companies)
 assert.equal((await root.query('SELECT "officeId" FROM "CrmEnquiry" WHERE id=$1',[leadA.id])).rows[0].officeId,a.id)
})
test('restricted sharing cannot bypass either organizational scope or missing profile actions',async()=>{
 try {
 await sharing(true);await read(leadB,404)
 await sharing(true,[{kind:'USER',id:manager.id,level:'READ'}]);await read(leadB)
 await offices(manager.id,[a.id],[],a.id);await read(leadB,404)
 await offices(manager.id,[],[{companyId:parent.id,includeSubsidiaries:true}],a.id);await read(leadB)
 await api('crm/enquiries/[id]','/api/crm/enquiries/'+leadB.id,'PATCH',{title:'Still read only',assignedUserId:workerB.id,status:'NEW',version:leadB.version},manager.id,403,{id:leadB.id})
 } finally { await sharing(false) }
})
test('dated placement, creation preference and reporting links remain independent',async()=>{
 await api('users/[id]','/api/users/'+workerA.id,'PATCH',{staffProfile:{managerUserId:manager.id,leaveApprovalMode:'REPORTING_MANAGER',schedulingMode:'STANDARD'}},admin,200,{id:workerA.id});const before=await employment()
 const path='/api/shifts/workplaces?staffId='+workerA.id,view=await api('shifts/workplaces',path)
 await api('shifts/workplaces','/api/shifts/workplaces','POST',{action:'assign',staffId:workerA.id,version:view.version,officeId:a.id,startsOn:view.today})
 const placed=await api('shifts/workplaces',path);assert.equal(placed.current.officeId,a.id)
 await offices(workerA.id,[a.id,b.id],[],a.id);await select(workerA.id,b.id)
 const after=await api('shifts/workplaces',path);assert.equal(after.current.id,placed.current.id);assert.deepEqual(await employment(),before)
 const forbidden=await create('STAFF','NoOfficeStaff',[])
 await api('users/[id]','/api/users/'+forbidden.id,'PATCH',{staffProfile:{leaveApprovalMode:'TENANT_ADMIN',schedulingMode:'STANDARD'}},admin,200,{id:forbidden.id})
 const none=await api('shifts/workplaces','/api/shifts/workplaces?staffId='+forbidden.id)
 await api('shifts/workplaces','/api/shifts/workplaces','POST',{action:'assign',staffId:forbidden.id,version:none.version,officeId:a.id,startsOn:none.today},admin,403)
})
test('current team authority and CRM activation narrow the same office-authorized records',async()=>{
 await teamMember(teamB,manager,false);assert.equal((await listing()).total,1);await read(leadB,404)
 await teamMember(teamB,manager,true);assert.equal((await listing()).total,2)
 await root.query(`UPDATE "TenantModule" SET enabled=false WHERE "tenantId"=$1 AND key='crm'`,[t]);try{await api('crm/enquiries','/api/crm/enquiries','GET',undefined,manager.id,403);assert.ok((await api('workspace/offices','/api/workspace/offices','GET',undefined,manager.id)).total>=2)}finally{await root.query(`UPDATE "TenantModule" SET enabled=true WHERE "tenantId"=$1 AND key='crm'`,[t])}
 await read(leadB)
})
test('revoking the profile removes business Read without granting access through leadership or offices',async()=>{
 const assignment=await api('access/users/[id]','/api/access/users/'+manager.id,'GET',undefined,admin,200,{id:manager.id})
 await api('access/users/[id]','/api/access/users/'+manager.id,'PATCH',{version:assignment.accessPolicy.version,roleIds:[],rules:assignment.accessPolicy.rules},admin,200,{id:manager.id})
 await api('crm/enquiries','/api/crm/enquiries','GET',undefined,manager.id,403);assert.ok((await api('workspace/offices','/api/workspace/offices','GET',undefined,manager.id)).total>=2)
 assert.equal((await root.query('SELECT count(*)::int n FROM "BusinessTeamMember" WHERE "userId"=$1 AND "isManager"',[manager.id])).rows[0].n,2)
})
