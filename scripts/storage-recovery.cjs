/* eslint-disable @typescript-eslint/no-require-imports */
// Storage recovery companion to the application database backup. No hosted writes.
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { spawnSync } = require('node:child_process')
const assert = require('node:assert/strict')

const BUCKETS = ['tenant-branding', 'tenant-documents']
const LIMIT = 10 * 1024 * 1024
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex')
function protect(bytes, decrypt = false) {
  assert.equal(process.platform, 'win32', 'This recovery key uses Windows CurrentUser protection')
  const script = `Add-Type -AssemblyName System.Security; $b=[Convert]::FromBase64String([Console]::In.ReadToEnd()); $o=[Security.Cryptography.ProtectedData]::${decrypt ? 'Unprotect' : 'Protect'}($b,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser); $s=[Console]::OpenStandardOutput(); $s.Write($o,0,$o.Length)`
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { input: bytes.toString('base64'), maxBuffer: 1024 * 1024, windowsHide: true })
  assert.equal(result.status, 0, 'Windows recovery key protection failed')
  return result.stdout
}
function seal(bytes, key, label) {
  const iv = crypto.randomBytes(12), cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
  cipher.setAAD(Buffer.from(label))
  return Buffer.concat([iv, cipher.update(bytes), cipher.final(), cipher.getAuthTag()])
}
function open(bytes, key, label) {
  assert.ok(bytes.length >= 28, 'Truncated encrypted file')
  const cipher = crypto.createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12))
  cipher.setAAD(Buffer.from(label)); cipher.setAuthTag(bytes.subarray(-16))
  return Buffer.concat([cipher.update(bytes.subarray(12, -16)), cipher.final()])
}
function objectPath(name) {
  assert.ok(typeof name === 'string' && name.length <= 1024 && name.split('/').every(part => /^[a-zA-Z0-9_.-]+$/.test(part) && part !== '.' && part !== '..'), 'Unsafe object path')
  return name
}
function privateDirectory(dir) {
  fs.mkdirSync(dir, { recursive: false, mode: 0o700 })
  if (process.platform === 'win32') {
    const script = '$p=[Console]::In.ReadToEnd(); $a=New-Object Security.AccessControl.DirectorySecurity; $a.SetAccessRuleProtection($true,$false); $sid=[Security.Principal.WindowsIdentity]::GetCurrent().User; $r=New-Object Security.AccessControl.FileSystemAccessRule($sid,"FullControl","ContainerInherit,ObjectInherit","None","Allow"); $a.AddAccessRule($r); Set-Acl -LiteralPath $p -AclObject $a'
    const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { input: path.resolve(dir), windowsHide: true })
    assert.equal(result.status, 0, 'Private recovery directory permissions failed')
  }
}
const write = (file, bytes) => fs.writeFileSync(file, bytes, { flag: 'wx', mode: 0o600 })
async function inventory(storage) {
  const result = []
  for (const bucket of BUCKETS) {
    const info = await storage.getBucket(bucket)
    assert.ok(!info.error && info.data, 'Required storage bucket unavailable')
    assert.equal(info.data.public, bucket === 'tenant-branding', 'Unexpected bucket privacy')
    const files = [], queue = ['']
    for (let index = 0; index < queue.length; index++) {
      const prefix = queue[index]
      for (let offset = 0; ; offset += 100) {
        const response = await storage.from(bucket).list(prefix, { limit: 100, offset, sortBy: { column: 'name', order: 'asc' } })
        assert.ok(!response.error && Array.isArray(response.data), 'Storage inventory failed')
        for (const item of response.data) {
          assert.ok(item.name && !item.name.includes('/'), 'Invalid inventory entry')
          const name = objectPath(prefix ? prefix + '/' + item.name : item.name)
          if (item.id == null && item.metadata == null) queue.push(name)
          else {
            assert.ok(item.id && Number.isSafeInteger(item.metadata?.size) && item.metadata.size >= 0 && item.metadata.size <= LIMIT, 'Unsupported object metadata or size')
            files.push({ path: name, id: item.id, updatedAt: item.updated_at, bytes: item.metadata.size, mime: item.metadata.mimetype || 'application/octet-stream' })
          }
        }
        if (response.data.length < 100) break
      }
    }
    files.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0)
    assert.equal(new Set(files.map(f => f.path)).size, files.length, 'Duplicate object in inventory')
    result.push({ bucket, public: info.data.public, fileSizeLimit: info.data.file_size_limit, allowedMimeTypes: info.data.allowed_mime_types, files })
  }
  return result
}
async function backup({ storage, project, out, databaseBackup, wrap = protect }) {
  assert.match(project, /^[a-z0-9]{20}$/)
  assert.equal(databaseBackup.source, project, 'Database and storage project must match')
  assert.match(databaseBackup.archiveSha256, /^[a-f0-9]{64}$/)
  assert.ok(Date.parse(databaseBackup.createdAt) <= Date.now() && Date.now() - Date.parse(databaseBackup.createdAt) < 3600000, 'Take the database backup immediately before storage')
  const before = await inventory(storage), id = crypto.randomUUID(), key = crypto.randomBytes(32)
  privateDirectory(out)
  try {
    write(path.join(out, 'key.dpapi'), wrap(key))
    const manifest = { format: 1, id, project, startedAt: new Date().toISOString(), databaseBackup: { id: databaseBackup.id, createdAt: databaseBackup.createdAt, archiveSha256: databaseBackup.archiveSha256 }, buckets: before }
    let count = 0, bytes = 0
    for (const bucket of manifest.buckets) for (const file of bucket.files) {
      const response = await storage.from(bucket.bucket).download(file.path)
      assert.ok(!response.error && response.data && response.data.size === file.bytes, 'Object download failed or changed')
      const data = Buffer.from(await response.data.arrayBuffer())
      try {
        file.sha256 = sha(data); file.file = String(count++) + '.enc'
        write(path.join(out, file.file), seal(data, key, id + ':' + bucket.bucket + ':' + file.path))
        bytes += data.length
      } finally { data.fill(0) }
    }
    const after = await inventory(storage)
    const comparable = manifest.buckets.map(b => ({ ...b, files: b.files.map(entry => { const copy = { ...entry }; delete copy.sha256; delete copy.file; return copy }) }))
    assert.deepEqual(after, comparable, 'Storage changed during backup; discard this incomplete backup and retry')
    manifest.completedAt = new Date().toISOString()
    // Written last: incomplete directories never have a usable manifest.
    write(path.join(out, 'manifest.enc'), seal(Buffer.from(JSON.stringify(manifest)), key, 'ls-erp-storage-v1'))
    return { id, project, objects: count, bytes, databaseBackup: databaseBackup.id }
  } finally { key.fill(0) }
}
function load(dir, unwrap) {
  const key = unwrap(fs.readFileSync(path.join(dir, 'key.dpapi')), true)
  try {
    const manifest = JSON.parse(open(fs.readFileSync(path.join(dir, 'manifest.enc')), key, 'ls-erp-storage-v1'))
    assert.equal(manifest.format, 1); assert.match(manifest.id, /^[a-f0-9-]{36}$/)
    assert.deepEqual(manifest.buckets.map(b => b.bucket), BUCKETS)
    const seen = new Set(), filenames = new Set()
    for (const b of manifest.buckets) for (const f of b.files) {
      objectPath(f.path); assert.match(f.file, /^[0-9]+\.enc$/); assert.match(f.sha256, /^[a-f0-9]{64}$/)
      assert.ok(Number.isSafeInteger(f.bytes) && f.bytes >= 0 && f.bytes <= LIMIT)
      const name = b.bucket + '/' + f.path
      assert.ok(!seen.has(name) && !filenames.has(f.file), 'Duplicate backup entry'); seen.add(name); filenames.add(f.file)
    }
    return { manifest, key }
  } catch (error) { key.fill(0); throw error }
}
function readObject(dir, key, manifest, bucket, file) {
  const filename = path.join(dir, file.file)
  assert.equal(fs.statSync(filename).size, file.bytes + 28, 'Encrypted size mismatch')
  const data = open(fs.readFileSync(filename), key, manifest.id + ':' + bucket.bucket + ':' + file.path)
  assert.equal(sha(data), file.sha256, 'Recovered object checksum mismatch')
  return data
}
function verify({ dir, unwrap = protect }) {
  const { manifest, key } = load(dir, unwrap)
  let objects = 0, bytes = 0
  try {
    for (const bucket of manifest.buckets) for (const file of bucket.files) {
      const data = readObject(dir, key, manifest, bucket, file); bytes += data.length; objects++; data.fill(0)
    }
    return { verified: true, id: manifest.id, project: manifest.project, objects, bytes, databaseBackup: manifest.databaseBackup.id }
  } finally { key.fill(0) }
}
function recover({ dir, out, unwrap = protect }) {
  const report = verify({ dir, unwrap }) // Authenticate every object before writing plaintext.
  const { manifest, key } = load(dir, unwrap)
  try {
    privateDirectory(out)
    for (const bucket of manifest.buckets) for (const file of bucket.files) {
      const destination = path.resolve(out, bucket.bucket, file.path)
      assert.ok(destination.startsWith(path.resolve(out) + path.sep), 'Recovery path escaped target')
      fs.mkdirSync(path.dirname(destination), { recursive: true, mode: 0o700 })
      const data = readObject(dir, key, manifest, bucket, file)
      try { write(destination, data) } finally { data.fill(0) }
      assert.equal(sha(fs.readFileSync(destination)), file.sha256)
    }
    write(path.join(out, 'storage-manifest.json'), JSON.stringify(manifest, null, 2))
    return { ...report, recovered: true }
  } finally { key.fill(0) }
}
async function main() {
  const [mode, ...args] = process.argv.slice(2), options = {}
  assert.equal(args.length % 2, 0, 'Options require values')
  for (let i = 0; i < args.length; i += 2) { assert.ok(/^--[a-z-]+$/.test(args[i]) && !options[args[i]]); options[args[i]] = args[i + 1] }
  if (mode === 'verify' || mode === 'recover') {
    assert.ok(options['--dir']); if (mode === 'recover') assert.ok(options['--out'])
    console.log(JSON.stringify((mode === 'verify' ? verify : recover)({ dir: options['--dir'], out: options['--out'] }))); return
  }
  assert.equal(mode, 'backup', 'Use backup, verify, or recover')
  for (const key of ['--env', '--project', '--out', '--database-backup']) assert.ok(options[key], 'Missing option ' + key)
  const env = require('dotenv').parse(fs.readFileSync(options['--env']))
  const url = new URL(env.SUPABASE_URL)
  assert.equal(url.origin, 'https://' + options['--project'] + '.supabase.co', 'Explicit project does not match environment')
  const secret = env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY
  assert.ok(secret, 'Missing server storage key')
  const storage = require('@supabase/supabase-js').createClient(url.origin, secret, { auth: { persistSession: false, autoRefreshToken: false } }).storage
  const databaseBackup = JSON.parse(fs.readFileSync(options['--database-backup']))
  assert.match(databaseBackup.id, /^[a-f0-9]{12}$/)
  assert.match(databaseBackup.encryptedSha256, /^[a-f0-9]{64}$/)
  const databaseDirectory = path.dirname(options['--database-backup'])
  assert.equal(sha(fs.readFileSync(path.join(databaseDirectory, databaseBackup.id + '.pgdump.enc'))), databaseBackup.encryptedSha256, 'Encrypted database backup integrity failed')
  assert.ok(fs.statSync(path.join(databaseDirectory, databaseBackup.id + '.key.dpapi')).size > 0, 'Database recovery key missing')
  const report = await backup({ storage, project: options['--project'], out: options['--out'], databaseBackup })
  console.log(JSON.stringify({ ...report, ...verify({ dir: options['--out'] }) }))
}
module.exports = { backup, verify, recover, inventory, protect, seal, open, privateDirectory }
if (require.main === module) main().catch(() => { console.error('Storage recovery failed. Check explicit paths/project, credentials, Windows account and backup integrity. Incomplete output must not be used.'); process.exitCode = 1 })
