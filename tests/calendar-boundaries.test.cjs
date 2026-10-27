/* eslint-disable @typescript-eslint/no-require-imports */
const {test}=require('node:test'),assert=require('node:assert/strict')
const {dateKeyToUtcDate,addDaysToDateKey,startOfBusinessDate}=require('../lib/business-time.ts')

test('calendar offsets cross leap/month/year boundaries independently of the host timezone',()=>{
 const previous=process.env.TZ
 try{
  for(const zone of ['UTC','America/Los_Angeles','Asia/Kolkata']){
   process.env.TZ=zone
   assert.equal(dateKeyToUtcDate('2028-02-29').toISOString(),'2028-02-29T00:00:00.000Z')
   assert.equal(addDaysToDateKey('2028-02-28',1),'2028-02-29')
   assert.equal(addDaysToDateKey('2028-03-01',-1),'2028-02-29')
   assert.equal(addDaysToDateKey('2026-12-31',1),'2027-01-01')
  }
 }finally{if(previous===undefined)delete process.env.TZ;else process.env.TZ=previous}
})
test('inclusive report end dates use calendar offsets rather than a fixed 24-hour interval',()=>{
 for(const [day,zone,hours] of [['2026-03-08','America/New_York',23],['2026-11-01','America/New_York',25],['2026-10-28','Asia/Kathmandu',24]]){
  const from=startOfBusinessDate(day,zone),until=startOfBusinessDate(addDaysToDateKey(day,1),zone)
  assert.equal((until-from)/3600000,hours)
  assert.ok(from<until)
 }
})
test('a skipped tenant calendar date has an empty interval without including the next day',()=>{
 const day='2011-12-30',zone='Pacific/Apia'
 assert.equal(startOfBusinessDate(day,zone).getTime(),startOfBusinessDate(addDaysToDateKey(day,1),zone).getTime())
})
