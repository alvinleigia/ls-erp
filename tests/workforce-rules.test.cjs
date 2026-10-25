/* eslint-disable @typescript-eslint/no-require-imports */

const { test } = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')

test('past roster display uses saved bounds and paid minutes without reconstructing template breaks',()=>{
 const {historyPeriods,rosterPaidMinutes}=require('../app/(protected)/shifts/roster/roster-model.ts')
 const saved={startTime:'09:00',endTime:'17:00',paidMinutes:420}
 assert.deepEqual(historyPeriods(saved),[{startTime:'09:00',endTime:'17:00'}])
 assert.equal(rosterPaidMinutes(saved,historyPeriods(saved)),420)
 assert.deepEqual(historyPeriods({startTime:null,endTime:null}),[])
 assert.equal(rosterPaidMinutes({paidMinutes:0},[{startTime:'09:00',endTime:'17:00'}]),0)
 assert.equal(rosterPaidMinutes(null,[{startTime:'09:00',endTime:'12:00'},{startTime:'13:00',endTime:'17:00'}]),420)
})

test('flexible history capture scopes staff, merges ranges, preserves gaps and bounds source batches',async t=>{
 const {captureFlexiblePlanHistory:capture}=require('../modules/workforce/plan-history.ts')
 const history=require('../modules/workforce/roster-history.ts'),calls=[]
 const stub=t.mock.method(history,'syncRosterHistoryRange',async(_tx,input)=>calls.push(input))
 let exists=true
 const tx={staffProfile:{findFirst:async({where})=>{assert.deepEqual(where,{id:'staff',user:{tenantId:'a'},schedulingMode:'FLEXIBLE'});return exists?{id:'staff'}:null}},appSetting:{findUnique:async()=>({timeZone:'Asia/Kolkata'})}}
 const range=(a,b)=>({startDate:new Date(a),endDate:new Date(b)})
 try{
  await assert.rejects(()=>capture(noDatabase,'','staff',[]),e=>e.status===403)
  await capture(tx,'a','staff',[range('2020-01-01','2020-12-31'),range('2020-12-31','2021-01-03'),range('2021-01-10','2021-01-11'),range('2099-01-01','2099-01-02')])
  assert.deepEqual(calls.map(r=>[r.startDate,r.endDate]),[['2020-01-01','2020-12-31'],['2021-01-01','2021-01-03'],['2021-01-10','2021-01-11']])
  for(const c of calls){assert.equal(c.mode,'insert-missing');assert.equal(c.tenantId,'a');assert.deepEqual(c.staffProfileIds,['staff'])}
  exists=false;await capture(tx,'a','staff',[range('2020-01-01','2020-01-07')]);assert.equal(calls.length,3)
 }finally{stub.mock.restore()}
})

// Capture deliveries locally; these tests never contact SMTP or a database.
const sent = []
let emailEnabled = true
const mailerPath = path.resolve(__dirname, '../lib/mailer.ts')
require.cache[mailerPath] = {
  id: mailerPath, filename: mailerPath, loaded: true,
  exports: {
    canSendConfiguredEmail: async (_tx, tenantId) => { assert.equal(tenantId, 'tenant-a'); return emailEnabled },
    mailFrom: 'test@example.test', mailer: { sendMail: async message => sent.push(message) },
  },
}
const requests = require('../modules/workforce/leave-requests.ts')
const definitions = require('../modules/workforce/leave-definitions.ts')
const groups = require('../modules/workforce/leave-groups.ts')
const notifications = require('../modules/workforce/leave-notifications.ts')
const noDatabase = new Proxy({}, { get() { throw Error('Unexpected unscoped database access') } })

test('shared leave helpers reject missing tenant scope before database work or delivery', async () => {
  const calls = [
    () => requests.validateCreateLeaveRequestRules({ tx: noDatabase }),
    () => requests.buildLeaveRequestRuleChecks({ tx: noDatabase }),
    () => requests.findLeaveApprovalConflicts(noDatabase, []),
    () => definitions.replaceNonClubbableRules(noDatabase, 'definition', []),
    () => groups.replaceGroupLeaves(noDatabase, 'group', []),
    () => groups.replaceGroupStaffAssignments(noDatabase, 'group', 'ALL_STAFF', []),
    ...Object.values(notifications).map(notify => () => notify(noDatabase, {})),
  ]
  for (const call of calls) await assert.rejects(call, error => error.status === 403 && /Tenant context/.test(error.message))
  assert.equal(sent.length, 0)
})

test('leave lifecycle guards retain valid transitions and reject repeated or terminal actions', () => {
  requests.assertReviewTransitionAllowed('PENDING')
  requests.assertCancelTransitionAllowed('PENDING')
  requests.assertRevokeTransitionAllowed('APPROVED')
  for (const state of ['APPROVED', 'REJECTED', 'CANCELED', 'REVOKED']) assert.throws(() => requests.assertReviewTransitionAllowed(state))
  for (const state of ['PENDING', 'REJECTED', 'CANCELED', 'REVOKED']) assert.throws(() => requests.assertRevokeTransitionAllowed(state))
})

test('notification settings and every recipient lookup stay within the supplied tenant', async () => {
  const payload = { tenantId: 'tenant-a', staffUserId: 'staff-a', leaveCode: 'AL', leaveName: 'Annual leave', startDateIso: '2030-10-07', endDateIso: '2030-10-07', daysCount: 1 }
  const tx = {
    staffProfile: { findFirst: async ({ where }) => { assert.equal(where.user.tenantId, payload.tenantId); assert.equal(where.userId, payload.staffUserId); return { managerUserId: 'manager-a', leaveApprovalMode: 'REPORTING_MANAGER' } } },
    $queryRaw: async (_sql, ...values) => { assert(values.includes(payload.tenantId)); assert(values.includes('manager-a')); return [{ role: 'MANAGER', slug: payload.tenantId, status: 'ACTIVE', rules: { 'leaveApprovals.read': 'REPORTS', 'leaveApprovals.approve': 'REPORTS' }, managedTeamIds: [], memberTeamIds: [], accessAssignments: [{ roleId: 'reviewer', role: { archived: false, permissions: ['leaveApprovals.read', 'leaveApprovals.approve'] } }] }] },
    user: {
    findFirst: async ({ where }) => { assert.equal(where.tenantId, payload.tenantId); assert.equal(where.id, 'manager-a'); assert.equal(where.status, 'ACTIVE'); return { email: 'manager@example.test' } },
    findUnique: async ({ where }) => {
      assert.equal(where.tenantId, payload.tenantId)
      if (where.id === 'manager-a') return { email: 'manager@example.test', status: 'ACTIVE', role: 'MANAGER' }
      assert.equal(where.id, 'staff-a')
      return { name: 'Staff', email: 'staff@example.test', role: 'STAFF', staffProfile: { managerUserId: 'manager-a' } }
    },
    findMany: async ({ where }) => {
      assert.equal(where.tenantId, payload.tenantId)
      return [{ email: 'admin@example.test' }]
    },
  } }
  await notifications.notifyLeaveSubmitted(tx, payload)
  assert.deepEqual(sent.splice(0).map(row => row.to).sort(), ['admin@example.test', 'manager@example.test'])
  await notifications.notifyLeaveReviewed(tx, { ...payload, status: 'APPROVED', reviewerName: 'Manager', reviewerComment: null })
  assert.deepEqual(sent.splice(0).map(row => row.to), ['staff@example.test'])
  await notifications.notifyLeaveCanceled(tx, { ...payload, canceledByUserId: 'staff-a', canceledByName: 'Staff', cancelReason: null })
  assert.deepEqual(sent.splice(0).map(row => row.to).sort(), ['admin@example.test', 'manager@example.test'])
  await notifications.notifyLeaveCanceled(tx, { ...payload, canceledByUserId: 'admin-a', canceledByName: 'Admin', cancelReason: null })
  assert.deepEqual(sent.splice(0).map(row => row.to), ['staff@example.test'])
  await notifications.notifyLeaveRevoked(tx, { ...payload, revokedByName: 'Admin', revokeReason: null })
  assert.deepEqual(sent.splice(0).map(row => row.to), ['staff@example.test'])
  emailEnabled = false
  for (const notify of Object.values(notifications)) await notify(noDatabase, payload)
  assert.equal(sent.length, 0)
})


test('partial leave edits contain only submitted fields, including explicit false, zero and empty lists', () => {
 const { updateLeaveDefinitionSchema, updateLeaveGroupSchema } = require('../lib/validation.ts')
 for (const schema of [updateLeaveDefinitionSchema, updateLeaveGroupSchema]) {
  assert.deepEqual(schema.parse({name:'Rename only'}),{name:'Rename only'})
  assert.equal(schema.safeParse({}).success,false)
 }
 const definition={noticeDays:0,allowCarryForward:false,nonClubbableWithIds:[]}
 assert.deepEqual(updateLeaveDefinitionSchema.parse(definition),definition)
 const group={assignmentMode:'ALL_STAFF',staffIds:[],sortOrder:0}
 assert.deepEqual(updateLeaveGroupSchema.parse(group),group)
})


test('roster dates validate real dates and keep date-only values independent of server timezone', () => {
 const {execFileSync}=require('node:child_process')
 const code=`const assert=require('node:assert/strict');const d=require('./modules/workforce/roster-dates.ts');
 assert.equal(d.parseDateOnly('2035-02-29'),null);assert.equal(d.parseDateOnly('2036-02-29').toISOString(),'2036-02-29T00:00:00.000Z');
 assert.deepEqual(d.enumerateDates(d.parseDateOnly('2026-03-07'),d.parseDateOnly('2026-03-10')).map(d.dateKey),['2026-03-07','2026-03-08','2026-03-09','2026-03-10']);
 const h=require('./modules/workforce/roster-history.ts');assert.deepEqual(h.normalizeHistoryRangeToPast('2020-01-06','2020-01-07','Asia/Kolkata'),{startDate:'2020-01-06',endDate:'2020-01-07'});
 const rows=[],scoped=async({where})=>{assert.equal(where.staffProfile.user.tenantId,'a');return []};
 const db={staffScheduleAssignment:{findMany:scoped},staffShiftOverride:{findMany:scoped},leaveRequest:{findMany:scoped},staffFlexibleAvailability:{findMany:scoped},
 staffProfile:{findMany:async({where})=>{assert.equal(where.user.tenantId,'a');return [{id:'own',schedulingMode:'STANDARD'}]}},
 shiftSchedule:{findFirst:async({where})=>{assert.equal(where.tenantId,'a');return {id:'schedule',startDate:new Date('2026-03-07'),weekOffDay1:'SUNDAY',weekOffDay2:null,weekOff2Weeks:[],blocks:[{templateId:'t',repeatDays:1,sortOrder:0,template:{id:'t',name:'Day',startTime:'09:00',endTime:'17:00',breaks:[]}}]}}},
 staffRosterHistoryDay:{upsert:async({create})=>rows.push(create)}};
 h.syncRosterHistoryRange(db,{tenantId:'a',staffProfileIds:['own','foreign'],startDate:'2026-03-07',endDate:'2026-03-10',mode:'replace'}).then(()=>{
 assert.deepEqual(rows.map(r=>r.date.toISOString()),['2026-03-07T00:00:00.000Z','2026-03-08T00:00:00.000Z','2026-03-09T00:00:00.000Z','2026-03-10T00:00:00.000Z']);
 assert.deepEqual(rows.map(r=>r.source),['SCHEDULE','OFF','SCHEDULE','SCHEDULE']);assert.ok(rows.every(r=>r.staffProfileId==='own'));}).catch(e=>{console.error(e);process.exitCode=1});`
 for(const TZ of ['UTC','Asia/Kolkata','America/Los_Angeles'])execFileSync(process.execPath,['--require','./tests/register.cjs','-e',code],{cwd:path.resolve(__dirname,'..'),env:{...process.env,TZ}})
})

test('appointment day ranges handle UTC boundaries, overnight, midnight and DST rollback',()=>{
 const {appointmentRangeOnDate:range}=require('../modules/workforce/roster-dates.ts')
 const check=(start,end,day,tz)=>range(new Date(start),new Date(end),day,tz)
 assert.deepEqual(check('2037-01-08T04:00:00Z','2037-01-08T05:00:00Z','2037-01-07','America/Los_Angeles'),{start:1200,end:1260})
 assert.deepEqual(check('2037-01-06T19:00:00Z','2037-01-06T20:00:00Z','2037-01-07','Asia/Kolkata'),{start:30,end:90})
 assert.equal(check('2037-01-07T07:00:00Z','2037-01-07T08:00:00Z','2037-01-07','America/Los_Angeles'),null)
 assert.deepEqual(check('2037-01-07T07:00:00Z','2037-01-07T09:00:00Z','2037-01-07','America/Los_Angeles'),{start:0,end:60})
 assert.deepEqual(check('2026-11-01T08:45:00Z','2026-11-01T09:15:00Z','2026-11-01','America/Los_Angeles'),{start:0,end:1440})
})

test('daily roster schemas reject impossible dates, reversed ranges and invalid clock times',()=>{
 const {shiftOverrideSchema,flexibleSlotSchema}=require('../lib/validation.ts')
 const {workforceDateRangeSchema,deleteOverrideSchema,deleteFlexibleSlotSchema}=require('../modules/workforce/schedule-validation.ts')
 for(const schema of [workforceDateRangeSchema,deleteOverrideSchema,shiftOverrideSchema])for(const [startDate,endDate] of [['2035-02-29','2035-03-01'],['2036-02-29','2036-02-28']])assert.equal(schema.safeParse({staffId:'staff',isUnavailable:true,startDate,endDate}).success,false)
 assert.equal(deleteFlexibleSlotSchema.safeParse({staffId:'staff',date:'2035-02-29'}).success,false)
 for(const startTime of ['25:00','12:60'])assert.equal(flexibleSlotSchema.safeParse({staffId:'staff',date:'2037-01-07',slots:[{startTime,endTime:'26:00'}]}).success,false)
})

test('history rejects missing tenant context before touching the database',async()=>{
 const h=require('../modules/workforce/roster-history.ts')
 for(const fn of [h.syncRosterHistoryRange,h.captureRosterHistoryUpToYesterday])await assert.rejects(()=>fn(noDatabase,{staffProfileIds:['foreign'],startDate:'2020-01-06',endDate:'2020-01-07'}),e=>e.status===403)
})

test('scheduling mode cutoffs use the tenant calendar day and Monday across UTC and DST boundaries',()=>{
 const {schedulingModeDates}=require('../modules/workforce/staff-scheduling-mode.ts')
 const dates=(instant,zone)=>{const r=schedulingModeDates(new Date(instant),zone);return [r.today.toISOString().slice(0,10),r.weekStart.toISOString().slice(0,10)]}
 assert.deepEqual(dates('2026-10-18T20:00:00Z','Asia/Kolkata'),['2026-10-19','2026-10-19'])
 assert.deepEqual(dates('2026-10-19T02:00:00Z','America/Los_Angeles'),['2026-10-18','2026-10-12'])
 assert.deepEqual(dates('2026-11-01T09:30:00Z','America/Los_Angeles'),['2026-11-01','2026-10-26'])
})

test('standard rotation and browser maps agree across timezones, week-offs and schedule start bounds',()=>{
 const {execFileSync}=require('node:child_process')
 const code=`const assert=require('node:assert/strict');const {buildStandardScheduleMap:map}=require('./modules/workforce/standard-schedule.ts');
 const {buildScheduleMap:ui}=require('./app/(protected)/shifts/roster/roster-model.ts');
 const schedule={startDate:'2026-03-06',weekOffDay1:'SUNDAY',weekOffDay2:'SATURDAY',weekOff2Weeks:[2],blocks:[{templateId:'late',repeatDays:1,sortOrder:1},{templateId:'early',repeatDays:2,sortOrder:0}]};
 const keys=['2026-03-05','2026-03-06','2026-03-07','2026-03-08','2026-03-09','2026-03-10'];
 const expected=[null,'early','early',null,'late','early'];
 assert.deepEqual([...map(schedule,new Date(keys[0]),new Date(keys[5])).values()],expected);
 const local=keys.map(key=>{const [y,m,d]=key.split('-').map(Number);return new Date(y,m-1,d)});
 assert.deepEqual(Object.values(ui(schedule,local)),expected);
 assert.equal(map(schedule,new Date('2026-03-14'),new Date('2026-03-14')).get('2026-03-14'),null);
 schedule.weekOff2Weeks=[];assert.equal(map(schedule,new Date('2026-03-07'),new Date('2026-03-07')).get('2026-03-07'),null);`
 for(const TZ of ['UTC','Asia/Kolkata','America/Los_Angeles'])execFileSync(process.execPath,['--require','./tests/register.cjs','-e',code],{cwd:path.resolve(__dirname,'..'),env:{...process.env,TZ}})
})

test('shared working segments clip breaks and subtract overlapping pauses only once',()=>{
 const {workingSegments}=require('../modules/workforce/working-segments.ts')
 assert.deepEqual(workingSegments({startTime:'09:00',endTime:'17:00',breaks:[{startTime:'08:00',endTime:'09:30'},{startTime:'12:00',endTime:'13:00'},{startTime:'12:30',endTime:'13:30'},{startTime:'16:30',endTime:'19:00'}]}),[{start:570,end:720},{start:810,end:990}])
 assert.deepEqual(workingSegments({startTime:'09:00',endTime:'17:00',breaks:[{startTime:'08:00',endTime:'18:00'}]}),[])
})

test('flexible plan booking protection checks later pages with bounded scoped queries and no customer fields',async()=>{
 const {protectPlanBookings:protect}=require('../modules/workforce/plan-bookings.ts')
 await assert.rejects(()=>protect(noDatabase,'',{id:'staff'}),e=>e.status===403)
 let appointmentReads=0,planReads=0,changed=false
 const rows=Array.from({length:201},(_,i)=>({id:String(i).padStart(3,'0'),staffProfileId:'staff',staffProfile:{schedulingMode:'FLEXIBLE'},startAt:new Date('2038-01-'+(i===200?'05':'04')+'T10:00:00Z'),endAt:new Date('2038-01-'+(i===200?'05':'04')+'T11:00:00Z')}))
 const scoped=({where})=>{assert.equal(where.staffProfile.user.tenantId,'a');return []}
 const db={
  appSetting:{findUnique:async({where})=>{assert.equal(where.tenantId,'a');return {timeZone:'UTC'}}},
  appointment:{findMany:async({where,take,select})=>{
   appointmentReads++;assert.equal(where.tenantId,'a');assert.deepEqual(where.staffProfile.AND,[{id:'staff',schedulingMode:'FLEXIBLE'},{user:{tenantId:'a'}}]);assert.equal(take,200)
   assert.deepEqual(Object.keys(select).sort(),['endAt','id','staffProfile','staffProfileId','startAt']);return rows.filter(row=>!where.id||row.id>where.id.gt).slice(0,take)
  }},
  $queryRaw:async(_sql,tenant,ids)=>{assert.equal(tenant,'a');assert.deepEqual(ids,['staff']);return []},
  staffShiftOverride:{findMany:async input=>scoped(input)},leaveRequest:{findMany:async()=>{throw Error('Private leave details must not be read by the guard.')}},
  staffFlexibleWeekPlan:{findMany:async input=>{scoped(input);planReads++;return [{staffProfileId:'staff',weekStartDate:new Date('2038-01-04'),days:['MONDAY','TUESDAY'].map(day=>({day,isOff:changed&&day==='TUESDAY',slots:[{startTime:'09:00',endTime:'17:00',breaks:[]}]}))}]}},
  staffFlexiblePattern:{findMany:async input=>{planReads++;return scoped(input)}},staffFlexibleAvailability:{findMany:async input=>{planReads++;return scoped(input)}},
 }
 const check=await protect(db,'a',{id:'staff',schedulingMode:'FLEXIBLE'});assert.equal(appointmentReads,2);assert.equal(planReads,6)
 changed=true;await assert.rejects(check,e=>e.status===409&&/existing appointments/.test(e.message))
 assert.equal(appointmentReads,2);assert.equal(planReads,12)
})
test('daily plan guards bound candidates by UTC padding and use exact tenant dates before checking effective overrides',async()=>{
 const {protectPlanBookings:protect,PlanBookingConflict}=require('../modules/workforce/plan-bookings.ts')
 await (await protect(noDatabase,'a',{id:'staff'},[]))()
 let changed=false,reads=0
 const db={
  appSetting:{findUnique:async()=>({timeZone:'America/Los_Angeles'})},
  appointment:{findMany:async({where,select})=>{
   reads++;assert.equal(where.startAt.gte.toISOString(),'2038-01-06T00:00:00.000Z');assert.equal(where.startAt.lt.toISOString(),'2038-01-09T00:00:00.000Z')
   assert.equal(where.tenantId,'a');assert.ok(!select.customer)
   return ['07','08','09'].map((day,i)=>({id:String(i),staffProfileId:'staff',staffProfile:{schedulingMode:'FLEXIBLE'},startAt:new Date('2038-01-'+day+'T04:00Z'),endAt:new Date('2038-01-'+day+'T05:00Z')}))
  }},
  staffShiftOverride:{findMany:async({where})=>{
   assert.equal(where.date.gte.toISOString(),'2038-01-07T00:00:00.000Z');assert.equal(where.date.lte.toISOString(),'2038-01-07T00:00:00.000Z')
   return [{staffProfileId:'staff',date:new Date('2038-01-07'),template:{startTime:'09:00',endTime:changed?'17:00':'22:00',breaks:[]}}]
  }},
  $queryRaw:async(_sql,tenant,ids)=>{assert.equal(tenant,'a');assert.deepEqual(ids,['staff']);return []},
  leaveRequest:{findMany:async()=>{throw Error('Private leave details must not be read by the guard.')}},staffFlexibleWeekPlan:{findMany:async()=>[]},staffFlexiblePattern:{findMany:async()=>[]},staffFlexibleAvailability:{findMany:async()=>[]},
 }
 const check=await protect(db,'a',{id:'staff'},['2038-01-07']);changed=true
 await assert.rejects(check,e=>e instanceof PlanBookingConflict&&e.status===409&&JSON.stringify(e.appointmentIds)==='["1"]')
 assert.equal(reads,1)
})
