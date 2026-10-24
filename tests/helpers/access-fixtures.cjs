const {materializeRules}=require('./resource-policy-data.cjs')
/* eslint-disable @typescript-eslint/no-require-imports */
// Explicit pre-profile account fixtures for existing workflow regression tests.
// New-profile security tests deliberately create plain users instead.
const {allPermissions}=require('../../platform/access/catalog.ts')
const {createHash}=require('node:crypto')
const scopesByProfile=new Map()
function migratedPermissions(values){const p=new Set(values);for(const [from,to] of [['teams.read','teamMembers.read'],['teams.assign','teamMembers.assign'],['projects.read','projectMembers.read'],['projects.assign','projectMembers.assign'],['businessSettings.read','branding.read'],['businessSettings.edit','branding.edit'],['pipelines.read','configurationPresets.read'],['pipelines.create','configurationPresets.create']])if(p.has(from))p.add(to);p.delete('teams.assign');for(const key of ['restrictedFields.read','restrictedFields.edit','assignmentTargets.read'])p.add(key);return [...p]}
function guard(){const u=new URL(process.env.CRM_TEST_DATABASE_URL||'http://invalid');if(!['127.0.0.1','localhost'].includes(u.hostname)||u.pathname!='/ls_salon_crm_test')throw Error('Fixture grants require the disposable local test database.')}
async function grantFixtureUser(db,user){
 guard();if(!user.tenantId||!['STAFF','MANAGER'].includes(user.role))return user
 const roleId='fixture_access_'+createHash('sha256').update(user.tenantId).digest('hex').slice(0,24)
 await db.tenantAccessRole.upsert({where:{id:roleId},create:{id:roleId,tenantId:user.tenantId,name:'Account fixture access',nameKey:'account fixture access',permissions:allPermissions},update:{}})
 await db.tenantUserAccess.upsert({where:{tenantId_userId:{tenantId:user.tenantId,userId:user.id}},create:{tenantId:user.tenantId,userId:user.id,rules:materializeRules(user.role)},update:{}})
 if(!await db.tenantRoleAssignment.count({where:{tenantId:user.tenantId,userId:user.id}}))await db.tenantRoleAssignment.create({data:{tenantId:user.tenantId,userId:user.id,roleId}})
 return user
}
async function fixtureUser(db,args){return grantFixtureUser(db,await db.user.create(args))}
async function fixtureUsers(db,args){const result=await db.user.createMany(args);for(const data of args.data){const user=await db.user.findUnique({where:data.id?{id:data.id}:{email:data.email}});await grantFixtureUser(db,user)}return result}
async function fixtureProfile(db,args){const {salesRecordScope,projectRecordScope,...data}=args.data;const profile=await db.tenantAccessRole.create({...args,data:{...data,permissions:migratedPermissions(data.permissions)}});scopesByProfile.set(profile.id,{...(salesRecordScope?{salesRecordScope}:{}),...(projectRecordScope?{projectRecordScope}:{})});return profile}
async function fixtureRole(db,args){
 const {tenantId,userId}=args.data
 await db.tenantRoleAssignment.deleteMany({where:{tenantId,userId,role:{nameKey:'account fixture access'}}})
 const assignment=await db.tenantRoleAssignment.create(args),scopes=scopesByProfile.get(args.data.roleId)
 if(scopes&&Object.keys(scopes).length)await db.tenantUserAccess.update({where:{tenantId_userId:{tenantId,userId}},data:{rules:materializeRules((await db.user.findUnique({where:{id:userId}})).role,scopes.salesRecordScope,scopes.projectRecordScope)}})
 return assignment
}
async function resetFixtureRoles(db,args){const users=await db.user.findMany({where:{tenantId:args.where.tenantId,...(args.where.userId?{id:args.where.userId}:{})}});const result=await db.tenantRoleAssignment.deleteMany(args);for(const user of users){await grantFixtureUser(db,user);if(['STAFF','MANAGER'].includes(user.role))await db.tenantUserAccess.update({where:{tenantId_userId:{tenantId:user.tenantId,userId:user.id}},data:{rules:materializeRules(user.role),version:{increment:1}}})}return result}
async function assignProfiles(service,userId,roleIds,scopePatch={}){const current=await service.assignment(userId);return service.assign(userId,{roleIds,version:current.accessPolicy.version,rules:scopePatch.rules??((scopePatch.salesRecordScope||scopePatch.projectRecordScope)?materializeRules(current.role,scopePatch.salesRecordScope??current.accessPolicy.rules["enquiries.read"],scopePatch.projectRecordScope??current.accessPolicy.rules["projects.read"]):current.accessPolicy.rules)})}
async function grantPgFixtureUsers(db,tenantIds){
 guard();for(const user of (await db.query('SELECT id,"tenantId",role FROM "User" WHERE "tenantId"=ANY($1) AND role IN (\'STAFF\',\'MANAGER\')',[tenantIds])).rows){
  const roleId='fixture_access_'+createHash('sha256').update(user.tenantId).digest('hex').slice(0,24)
  await db.query('INSERT INTO "TenantAccessRole"(id,"tenantId",name,"nameKey",permissions,"updatedAt") VALUES($1,$2,\'Account fixture access\',\'account fixture access\',$3,now()) ON CONFLICT(id) DO NOTHING',[roleId,user.tenantId,allPermissions])
  await db.query('INSERT INTO "TenantUserAccess"("tenantId","userId",rules,"updatedAt") VALUES($1,$2,$3,now()) ON CONFLICT DO NOTHING',[user.tenantId,user.id,materializeRules(user.role)])
  await db.query('INSERT INTO "TenantRoleAssignment"("tenantId","userId","roleId","updatedAt") SELECT $1,$2,$3,now() WHERE NOT EXISTS(SELECT 1 FROM "TenantRoleAssignment" WHERE "tenantId"=$1 AND "userId"=$2)',[user.tenantId,user.id,roleId])
 }
}
module.exports={fixtureUser,fixtureUsers,fixtureRole,fixtureProfile,resetFixtureRoles,assignProfiles,grantPgFixtureUsers}
