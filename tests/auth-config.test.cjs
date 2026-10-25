/* eslint-disable @typescript-eslint/no-require-imports */
const {test}=require('node:test'),assert=require('node:assert/strict')
const config=require('../auth.config.ts').default
test('shared session decoding preserves signed tenant and platform claims without mutating the token',async()=>{
 const token={sub:'staff',role:'STAFF',tenantId:'tenant-a',tenantSlug:'east',platformAccessMode:null,organizationIds:[],organizationRolesById:{}}
 const before=structuredClone(token),session={user:{name:'Staff',email:'staff@example.test'}}
 const result=await config.callbacks.session({session,token})
 assert.deepEqual(token,before);assert.equal(result.user.id,'staff');assert.equal(result.user.tenantId,'tenant-a');assert.equal(result.user.role,'STAFF')
 assert.equal(config.session.strategy,'jwt');assert.equal(config.providers.length,0)
 const platform={...token,role:'ADMIN',tenantId:'platform',tenantSlug:'platform',platformAccessMode:'SUPER_ADMIN',organizationIds:['company'],organizationRolesById:{company:'OWNER'}}
 assert.equal((await config.callbacks.session({session:{user:{}},token:platform})).user.platformAccessMode,'SUPER_ADMIN')
})
test('shared redirect handling permits configured tenant hosts and rejects external lookalikes',async()=>{
 const previous=process.env.APP_ROOT_DOMAIN;process.env.APP_ROOT_DOMAIN='erp.example.test'
 try{
  const redirect=url=>config.callbacks.redirect({url,baseUrl:'https://erp.example.test'})
  assert.equal(await redirect('/dashboard'),'https://erp.example.test/dashboard')
  assert.equal(await redirect('https://east.erp.example.test/dashboard'),'https://east.erp.example.test/dashboard')
  assert.equal(await redirect('https://erp.example.test.evil.test/dashboard'),'https://erp.example.test')
  assert.equal(await redirect('https://evil.test/?next=erp.example.test'),'https://erp.example.test')
 }finally{if(previous===undefined)delete process.env.APP_ROOT_DOMAIN;else process.env.APP_ROOT_DOMAIN=previous}
})
