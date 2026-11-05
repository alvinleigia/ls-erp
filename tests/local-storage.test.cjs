/* eslint-disable @typescript-eslint/no-require-imports */
const { test } = require('node:test'), assert = require('node:assert/strict'), { randomBytes } = require('node:crypto')
require('./register.cjs')
const { storageConfiguration } = require('../platform/storage/client.ts')
const { jwt, validate, origin } = require('../scripts/local-storage.cjs')
const { cleanEnv } = require('../scripts/local-demo.cjs')
function environment(patch, operation) {
  const before = { ...process.env }
  for (const key of ['ERP_LOCAL_DEMO','NODE_ENV','VERCEL','VERCEL_ENV','VERCEL_PROJECT_ID','SUPABASE_URL','SUPABASE_SECRET_KEY','SUPABASE_SERVICE_ROLE_KEY','DATABASE_URL']) delete process.env[key]
  Object.assign(process.env, patch)
  try { operation() } finally { for (const key of Object.keys(process.env)) if (!(key in before)) delete process.env[key]; Object.assign(process.env, before) }
}
const local = { ERP_LOCAL_DEMO:'1', NODE_ENV:'development', DATABASE_URL:'postgresql://crm_test_runtime:synthetic@127.0.0.1:55445/ls_salon_crm_test', SUPABASE_URL:origin, SUPABASE_SECRET_KEY:'local-test-key' }

test('local storage permits only the owned loopback service with the dedicated local database', () => {
  environment(local, () => assert.equal(storageConfiguration().url, origin))
  for (const patch of [{SUPABASE_URL:'https://production.supabase.co'},{SUPABASE_URL:'http://localhost:55446'},{SUPABASE_URL:'http://127.0.0.1:54321'},{SUPABASE_URL:origin+'/other'},{SUPABASE_URL:origin+'?redirect=other'},{SUPABASE_URL:origin+'#other'},{DATABASE_URL:'postgresql://user@db.project.supabase.co:5432/postgres'},{DATABASE_URL:local.DATABASE_URL.replace('55445','5432')},{DATABASE_URL:local.DATABASE_URL.replace('ls_salon_crm_test','other')}]) environment({...local,...patch},()=>assert.throws(storageConfiguration))
})
test('the development storage exception is unavailable in production, Vercel, tests and ordinary local apps', () => {
  for (const patch of [{NODE_ENV:'production'},{NODE_ENV:'test'},{VERCEL:'1'},{VERCEL_ENV:'production'},{VERCEL_PROJECT_ID:'hosted-project'},{ERP_LOCAL_DEMO:''}]) environment({...local,...patch},()=>assert.throws(storageConfiguration))
  environment({NODE_ENV:'production',SUPABASE_URL:'https://production.supabase.co',SUPABASE_SECRET_KEY:'hosted-test-key'},()=>assert.equal(storageConfiguration().url,'https://production.supabase.co'))
  environment({NODE_ENV:'production',SUPABASE_URL:'http://production.supabase.co',SUPABASE_SECRET_KEY:'hosted-test-key'},()=>assert.throws(storageConfiguration))
})
test('missing storage credentials still fail explicitly', () => environment({...local,SUPABASE_SECRET_KEY:''},()=>assert.throws(storageConfiguration,error=>error.status===503)))
test('local role keys are signed, bound to the local issuer and validated before reuse', () => {
  const secret=randomBytes(36).toString('base64url'),values={LOCAL_STORAGE_PASSWORD:randomBytes(36).toString('base64url'),LOCAL_STORAGE_JWT_SECRET:secret,LOCAL_STORAGE_ANON_KEY:jwt(secret,'anon'),LOCAL_STORAGE_SERVICE_KEY:jwt(secret,'service_role')}
  assert.equal(validate(values),values)
  assert.throws(()=>validate({...values,LOCAL_STORAGE_SERVICE_KEY:jwt(randomBytes(36).toString('base64url'),'service_role')}))
  assert.throws(()=>validate({...values,LOCAL_STORAGE_SERVICE_KEY:jwt(secret,'anon')}))
  assert.throws(()=>validate({...values,LOCAL_STORAGE_SERVICE_KEY:values.LOCAL_STORAGE_SERVICE_KEY+'.extra'}))
  assert.throws(()=>validate({...values,LOCAL_STORAGE_JWT_SECRET:'short'}))
})
test('app subprocesses never inherit local storage administration secrets', () => {
  const before=process.env.LOCAL_STORAGE_JWT_SECRET;process.env.LOCAL_STORAGE_JWT_SECRET='administration-secret'
  try { assert.equal(cleanEnv({DATABASE_URL:'local',DIRECT_URL:'local'}).LOCAL_STORAGE_JWT_SECRET,'') } finally { if(before===undefined)delete process.env.LOCAL_STORAGE_JWT_SECRET;else process.env.LOCAL_STORAGE_JWT_SECRET=before }
})
