/* eslint-disable @typescript-eslint/no-require-imports */
// Historical access data for isolated regression fixtures only. The application
// has no account-role fallback; migration 110 contains the frozen translation.
const {allPermissions,accessResources}=require('../../platform/access/catalog.ts')
const {resourceRecordPolicies}=require('../../platform/access/resource-policy.ts')
function materializeRules(role,sales='ACCOUNT_ROLE',projects='ACCOUNT_ROLE'){
 const staff=role==='STAFF',s=staff?'OWN':sales==='ACCOUNT_ROLE'?'ALL':sales,p=staff?'ASSIGNED':projects==='ACCOUNT_ROLE'?'ALL':projects
 const teamAll=!staff&&s==='ALL'&&p==='ALL'
 return Object.fromEntries(allPermissions.map(key=>{
  const [r,a]=key.split('.'),family=resourceRecordPolicies[r];let scope='ALL'
  if(family==='sales')scope=s
  if(['contacts','accounts','activities'].includes(r)&&s==='OWN')scope='RELATED'
  if(family==='projects'&&r!=='catalogItems')scope=p
  if(r==='leaveRequests')scope='OWN'
  if(r==='auditLogs')scope='BUSINESS'
  if(r==='leaveApprovals')scope=staff?'NONE':'REPORTS'
  if(r==='assignmentTargets')scope=s
  if(r==='restrictedFields')scope=staff?'NONE':'ALL'
  if(r==='branding'&&a==='edit')scope='NONE'
  if(['teams','teamMembers'].includes(r))scope=teamAll?'ALL':a==='read'?'OWN':a==='create'?'NONE':'MANAGED_TEAMS'
  if(staff){
   if(['users','auditLogs','businessSettings','taxRates','branding'].includes(r)||['inventory','services','appointments','shifts'].includes(accessResources[r].module)||['leaveApprovals','leaveDefinitions','leaveGroups','teamMembers','projectMembers'].includes(r))scope='NONE'
   if(a!=='read'&&['pipelines','leadSources','lostReasons','activityTypes','activityPlans','followUpRules','customFields','quotationTemplates','projectSettings','catalogItems','teams','salesOrders','receivables','orderPayments','unitReservations'].includes(r))scope='NONE'
   if(r==='projects'&&!['read','export'].includes(a))scope='NONE'
   if(r==='salesOrders'&&a==='create')scope='OWN'
   if(r==='configurationPresets')scope='NONE'
   if(['enquiries','opportunities','activities'].includes(r)&&a==='assign')scope='NONE'
   if(['contacts','accounts','activities'].includes(r)&&!['read','export','assign'].includes(a))scope='OWN'
   if(r==='reports')scope='OWN'
   if(r==='quotationTemplates'&&a==='read')scope='ACTIVE'
  }
  return [key,scope]
 }))
}
module.exports={materializeRules}
