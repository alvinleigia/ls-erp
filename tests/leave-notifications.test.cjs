/* eslint-disable @typescript-eslint/no-require-imports */
const {test}=require('node:test'),assert=require('node:assert/strict'),path=require('node:path')
const messages=[],mailerPath=path.resolve(__dirname,'../lib/mailer.ts')
require.cache[mailerPath]={id:mailerPath,filename:mailerPath,loaded:true,exports:{canSendConfiguredEmail:async()=>true,mailFrom:'qa@example.test',mailer:{sendMail:async message=>messages.push(message)}}}
const {notifyLeaveSubmitted,notifyLeaveCanceled}=require('../modules/workforce/leave-notifications.ts')
const payload={tenantId:'tenant',staffUserId:'employee',leaveCode:'AL',leaveName:'Annual',startDateIso:'2030-10-07',endDateIso:'2030-10-07',daysCount:1}
function db({mode='REPORTING_MANAGER',managerId='manager',permissions=['leaveApprovals.read','leaveApprovals.approve'],read='REPORTS',approve='REPORTS'}={}){
 return {staffProfile:{findFirst:async()=>({managerUserId:managerId,leaveApprovalMode:mode})},user:{findMany:async args=>{assert.equal(args.where.role,'ADMIN');return[{email:'admin@example.test'}]},findFirst:async()=>({email:'manager@example.test'})},$queryRaw:async()=>[{role:'STAFF',slug:'tenant',status:'ACTIVE',rules:{'leaveApprovals.read':read,'leaveApprovals.approve':approve},managedTeamIds:[],memberTeamIds:[],accessAssignments:[{roleId:'approval',role:{archived:false,permissions}}]}]}
}
const recipients=()=>messages.map(message=>message.to).sort()
test('a designated Staff reporting manager receives submissions only with current approval permission',async()=>{
 messages.length=0;await notifyLeaveSubmitted(db(),payload);assert.deepEqual(recipients(),['admin@example.test','manager@example.test'])
 for(const options of [{permissions:[]},{read:'NONE'},{approve:'NONE'}]){messages.length=0;await notifyLeaveSubmitted(db(options),payload);assert.deepEqual(recipients(),['admin@example.test'])}
})
test('tenant-admin routing and self-reporting never send approval messages to a team manager',async()=>{
 for(const options of [{mode:'TENANT_ADMIN'},{managerId:'employee'}]){messages.length=0;await notifyLeaveSubmitted(db(options),payload);assert.deepEqual(recipients(),['admin@example.test'])}
})
test('self-cancellation notifies the configured readable reviewer instead of broadcasting to every Manager account',async()=>{
 messages.length=0;await notifyLeaveCanceled(db({permissions:['leaveApprovals.read']}),{...payload,canceledByUserId:'employee',canceledByName:'Employee',cancelReason:'Changed plans'});assert.deepEqual(recipients(),['admin@example.test','manager@example.test'])
 messages.length=0;await notifyLeaveCanceled(db({read:'NONE'}),{...payload,canceledByUserId:'employee',canceledByName:'Employee',cancelReason:null});assert.deepEqual(recipients(),['admin@example.test'])
})
