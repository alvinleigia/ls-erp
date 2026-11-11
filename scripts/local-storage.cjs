/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('node:fs'), path = require('node:path'), { randomBytes, createHmac, timingSafeEqual } = require('node:crypto')
const { spawnSync } = require('node:child_process'), dotenv = require('dotenv'), { createClient } = require('@supabase/supabase-js')
const { root, run } = require('./database-workflow.cjs')
const file = path.join(root, '.env.local-demo-storage'), origin = 'http://127.0.0.1:55446'
const compose = ['compose', '--env-file', file, '-f', path.join(root, 'compose.local-storage.yml')]
function jwt(secret, role) {
  const body = [ { alg: 'HS256', typ: 'JWT' }, { iss: 'local-demo', role, iat: Math.floor(Date.now()/1000)-60, exp: Math.floor(Date.now()/1000)+10*365*86400 } ].map(value => Buffer.from(JSON.stringify(value)).toString('base64url')).join('.')
  return body + '.' + createHmac('sha256', secret).update(body).digest('base64url')
}
function validate(values) {
  for (const key of ['LOCAL_STORAGE_PASSWORD', 'LOCAL_STORAGE_JWT_SECRET']) if (!/^[A-Za-z0-9_-]{40,}$/.test(values[key] || '')) throw Error('Invalid local storage credentials. Existing files were preserved.')
  for (const [key, role] of [['LOCAL_STORAGE_ANON_KEY', 'anon'], ['LOCAL_STORAGE_SERVICE_KEY', 'service_role']]) {
    const parts = (values[key] || '').split('.')
    if (parts.length !== 3) throw Error('Invalid local storage key format.')
    const [header, payload, signature] = parts
    const expected = createHmac('sha256', values.LOCAL_STORAGE_JWT_SECRET).update(header+'.'+payload).digest(), actual = Buffer.from(signature || '', 'base64url')
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw Error('Invalid local storage key signature.')
    const claims = JSON.parse(Buffer.from(payload, 'base64url'))
    if (claims.iss !== 'local-demo' || claims.role !== role || claims.exp <= Date.now()/1000) throw Error('Invalid local storage key claims.')
  }
  return values
}
function configuration(create = false) {
  if (!fs.existsSync(file)) {
    if (!create) return null
    for (const volume of ['ls-erp-local-storage_metadata', 'ls-erp-local-storage_files']) if (spawnSync('docker', ['volume', 'inspect', volume], { windowsHide: true, stdio: 'ignore' }).status === 0) throw Error('Local storage data exists but its credential file is missing. Recover .env.local-demo-storage before restarting.')
    const secret = randomBytes(36).toString('base64url'), values = { LOCAL_STORAGE_PASSWORD: randomBytes(36).toString('base64url'), LOCAL_STORAGE_JWT_SECRET: secret, LOCAL_STORAGE_ANON_KEY: jwt(secret, 'anon'), LOCAL_STORAGE_SERVICE_KEY: jwt(secret, 'service_role') }
    fs.writeFileSync(file, '# Local Docker Storage credentials only. Keep with its persistent volumes; never commit.\n'+Object.entries(values).map(([key,value])=>`${key}=${value}`).join('\n')+'\n', { mode: 0o600, flag: 'wx' })
  }
  return validate(dotenv.parse(fs.readFileSync(file)))
}
function storageEnvironment() {
  const values = configuration()
  return values ? { SUPABASE_URL: origin, SUPABASE_SECRET_KEY: values.LOCAL_STORAGE_SERVICE_KEY, SUPABASE_SERVICE_ROLE_KEY: '' } : {}
}
async function setupStorage() {
  const values = configuration(true)
  for (const name of ['db','api','gateway']) {
    const result = spawnSync('docker', ['inspect', '--format', '{{index .Config.Labels "com.leiwissen.purpose"}}', 'ls-erp-local-storage-'+name], { windowsHide: true, encoding: 'utf8', stdio: ['ignore','pipe','ignore'] })
    if (result.status === 0 && result.stdout.trim() !== 'local-demo-storage') throw Error('A local storage container name belongs to another service.')
  }
  await run('docker', [...compose, 'up', '-d', '--wait', '--wait-timeout', '180'], { ...process.env, ...values }, true)
  const client = createClient(origin, values.LOCAL_STORAGE_SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
  for (const [name, publicRead, limit, types] of [['tenant-documents', false, 10*1024*1024, ['application/pdf']], ['tenant-branding', true, 512*1024, ['image/png','image/webp']], ['tenant-verification', false, 5*1024*1024, ['application/pdf','image/jpeg','image/png']]]) {
    const current = await client.storage.getBucket(name)
    if (current.error) {
      if (!['404','400'].includes(String(current.error.statusCode)) && !/not found/i.test(current.error.message)) throw Error('Unable to inspect the local storage bucket.')
      const created = await client.storage.createBucket(name, { public: publicRead, fileSizeLimit: limit, allowedMimeTypes: types })
      if (created.error) throw Error('Unable to create the local storage bucket.')
    } else if (current.data.public !== publicRead || Number(current.data.file_size_limit) !== limit || [...(current.data.allowed_mime_types || [])].sort().join() !== [...types].sort().join()) throw Error('Local storage bucket configuration differs. Review it before continuing.')
  }
  console.log('Local Supabase Storage ready on 127.0.0.1:55446; document bucket private. Files and metadata persist in Docker volumes.')
  return storageEnvironment()
}
if (require.main === module) setupStorage().catch(() => { console.error('Local storage setup failed. Review its Docker service health; existing data and credentials were preserved.'); process.exitCode = 1 })
module.exports = { setupStorage, storageEnvironment, validate, jwt, origin }
