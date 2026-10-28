/* eslint-disable @typescript-eslint/no-require-imports */
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), crypto = require('node:crypto')
const { backup, verify, recover, protect, seal, open } = require('../scripts/storage-recovery.cjs')
const { verifyReferences,reference } = require('../scripts/document-recovery.cjs')
const project = 'abcdefghijklmnopqrst'
function fixture(t, extra = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ls-erp-storage-test-'))
  t.after(() => { assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep + 'ls-erp-storage-test-')); fs.rmSync(root, { recursive: true, force: true }) })
  const key = crypto.randomBytes(32)
  const wrap = (bytes, decrypt) => decrypt ? open(bytes, key, 'test-wrapper') : seal(bytes, key, 'test-wrapper')
  const files = {
    'tenant-branding': { 'tenant-a/logo/document.png': Buffer.from('private logo bytes'), 'tenant-a/logo/sidebar.webp': Buffer.from('sidebar bytes') },
    'tenant-documents': { 'tenant-b/quotations/quote-a/1/file.pdf': Buffer.from('%PDF-private quotation contents') },
    ...extra,
  }
  const calls = [], storage = {
    async getBucket(bucket) { return { data: { public: bucket === 'tenant-branding', file_size_limit: 10485760, allowed_mime_types: [bucket === 'tenant-branding' ? 'image/png' : 'application/pdf'] }, error: null } },
    from(bucket) { return {
      async list(prefix, { offset, limit }) {
        calls.push({ bucket, prefix, offset })
        const entries = new Map()
        for (const [name, bytes] of Object.entries(files[bucket])) {
          if (prefix && !name.startsWith(prefix + '/')) continue
          const suffix = prefix ? name.slice(prefix.length + 1) : name, [first, ...rest] = suffix.split('/')
          entries.set(first, rest.length ? { name: first, id: null, metadata: null } : { name: first, id: name, updated_at: '2026-10-21T00:00:00Z', metadata: { size: bytes.length, mimetype: bucket === 'tenant-branding' ? 'image/png' : 'application/pdf' } })
        }
        return { data: [...entries.values()].sort((a, b) => a.name.localeCompare(b.name)).slice(offset, offset + limit), error: null }
      },
      async download(name) { return { data: new Blob([files[bucket][name]]), error: null } },
    } },
  }
  const input = { storage, project, out: path.join(root, 'encrypted'), databaseBackup: { id: 'database-backup', source: project, archiveSha256: 'a'.repeat(64), createdAt: new Date().toISOString() }, wrap }
  return { root, files, storage, input, calls, wrap }
}
test('encrypted backup recovers every bucket path and exact bytes without cleartext metadata', async t => {
  const f = fixture(t), result = await backup(f.input)
  assert.equal(result.objects, 3)
  const checked = verify({ dir: f.input.out, unwrap: f.wrap })
  assert.equal(checked.verified, true); assert.equal(checked.databaseBackup, 'database-backup')
  for (const name of fs.readdirSync(f.input.out)) {
    const bytes = fs.readFileSync(path.join(f.input.out, name))
    assert.ok(!bytes.includes(Buffer.from('tenant-a')) && !bytes.includes(Buffer.from('private quotation contents')))
  }
  const out = path.join(f.root, 'recovered')
  assert.equal(recover({ dir: f.input.out, out, unwrap: f.wrap }).recovered, true)
  for (const [bucket, files] of Object.entries(f.files)) for (const [name, bytes] of Object.entries(files)) assert.deepEqual(fs.readFileSync(path.join(out, bucket, name)), bytes)
  const m = JSON.parse(fs.readFileSync(path.join(out, 'storage-manifest.json')))
  assert.equal(m.buckets[1].public, false)
  assert.throws(() => recover({ dir: f.input.out, out, unwrap: f.wrap }))
})
test('recursive inventory paginates beyond 100 files and 100 tenant folders', async t => {
  const many = Object.fromEntries(Array.from({ length: 105 }, (_, i) => ['tenant-a/logos/' + String(i).padStart(3, '0') + '.png', Buffer.from(String(i))]))
  for (let i = 0; i < 105; i++) many['tenant-' + i + '/logo.png'] = Buffer.from('logo')
  const f = fixture(t, { 'tenant-branding': many })
  assert.equal((await backup(f.input)).objects, 211)
  assert.equal(verify({ dir: f.input.out, unwrap: f.wrap }).objects, 211)
  assert.ok(f.calls.some(c => c.prefix === 'tenant-a/logos' && c.offset === 100))
  assert.ok(f.calls.some(c => c.prefix === '' && c.offset === 100))
})

test('issued order originals and replacements recover as separate exact private files',async t=>{
 const original=Buffer.from('%PDF-issued order original'),replacement=Buffer.from('%PDF-issued order replacement')
 const a='tenant-b/orders/order-a/document-a/first.pdf',b='tenant-b/orders/order-a/document-b/replacement.pdf'
 const f=fixture(t,{'tenant-documents':{[a]:original,[b]:replacement}})
 await backup(f.input);const out=path.join(f.root,'order-recovery');recover({dir:f.input.out,out,unwrap:f.wrap})
 const manifest=JSON.parse(fs.readFileSync(path.join(out,'storage-manifest.json')))
 const refs=[[a,original],[b,replacement]].map(([path,bytes])=>reference('tenant-b','issued-order','tenant-documents',{path,bytes:bytes.length,sha256:crypto.createHash('sha256').update(bytes).digest('hex')}))
 assert.deepEqual(verifyReferences(refs,manifest),{references:2,uniqueReferencedObjects:2,verified:true})
 assert.deepEqual(fs.readFileSync(path.join(out,'tenant-documents',a)),original);assert.deepEqual(fs.readFileSync(path.join(out,'tenant-documents',b)),replacement)
 assert.equal(manifest.buckets.find(r=>r.bucket==='tenant-documents').public,false)
})
test('empty buckets produce a valid recoverable archive', async t => {
  const f = fixture(t, { 'tenant-branding': {}, 'tenant-documents': {} })
  assert.equal((await backup(f.input)).objects, 0)
  assert.equal(recover({ dir: f.input.out, out: path.join(f.root, 'recovered'), unwrap: f.wrap }).objects, 0)
})
test('database project mismatch and stale backup are rejected before downloads', async t => {
  const f = fixture(t)
  await assert.rejects(backup({ ...f.input, project: 'z'.repeat(20) }), /must match/)
  await assert.rejects(backup({ ...f.input, databaseBackup: { ...f.input.databaseBackup, createdAt: '2020-01-01T00:00:00Z' } }), /immediately before/)
  assert.equal(f.calls.length, 0); assert.equal(fs.existsSync(f.input.out), false)
})
test('download failures never finalize a backup', async t => {
  const f = fixture(t), original = f.storage.from
  f.storage.from = b => ({ ...original(b), download: async () => ({ data: null, error: new Error('failure') }) })
  await assert.rejects(backup(f.input), /download/)
  assert.equal(fs.existsSync(path.join(f.input.out, 'manifest.enc')), false)
  assert.throws(() => verify({ dir: f.input.out, unwrap: f.wrap }))
})
test('changed inventory during capture rejects the snapshot', async t => {
  const f = fixture(t), original = f.storage.from
  f.storage.from = b => ({ ...original(b), download: async name => {
    const result = await original(b).download(name)
    f.files['tenant-documents']['tenant-c/new.pdf'] = Buffer.from('new document')
    return result
  } })
  await assert.rejects(backup(f.input), /Storage changed/)
  assert.equal(fs.existsSync(path.join(f.input.out, 'manifest.enc')), false)
})
test('same-size content replacement still changes inventory version', async t => {
  const f = fixture(t), original = f.storage.from; let changed = false
  f.storage.from = b => ({ ...original(b), list: async (...args) => {
    const result = await original(b).list(...args)
    if (changed) for (const item of result.data) if (item.id) item.updated_at = '2026-10-22T00:00:00Z'
    return result
  }, download: async name => { changed = true; return original(b).download(name) } })
  await assert.rejects(backup(f.input), /Storage changed/)
})
test('ciphertext corruption and wrong Windows key fail before plaintext recovery', async t => {
  const f = fixture(t); await backup(f.input)
  assert.throws(() => verify({ dir: f.input.out, unwrap: () => crypto.randomBytes(32) }))
  const file = path.join(f.input.out, '0.enc'), data = fs.readFileSync(file); data[12] ^= 1; fs.writeFileSync(file, data)
  const out = path.join(f.root, 'recovered')
  assert.throws(() => recover({ dir: f.input.out, out, unwrap: f.wrap })); assert.equal(fs.existsSync(out), false)
})
test('missing and swapped objects are rejected', async t => {
  const f = fixture(t); await backup(f.input)
  const first = fs.readFileSync(path.join(f.input.out, '0.enc'))
  fs.writeFileSync(path.join(f.input.out, '1.enc'), first)
  assert.throws(() => verify({ dir: f.input.out, unwrap: f.wrap }))
  fs.unlinkSync(path.join(f.input.out, '0.enc'))
  assert.throws(() => verify({ dir: f.input.out, unwrap: f.wrap }))
})
test('manifest corruption is rejected', async t => {
  const f = fixture(t); await backup(f.input)
  const file = path.join(f.input.out, 'manifest.enc'), data = fs.readFileSync(file); data[16] ^= 1; fs.writeFileSync(file, data)
  assert.throws(() => verify({ dir: f.input.out, unwrap: f.wrap }))
})
test('unexpected public document bucket and path traversal fail closed', async t => {
  const f = fixture(t)
  const original = f.storage.getBucket
  f.storage.getBucket = async b => { const r = await original(b); r.data.public = true; return r }
  await assert.rejects(backup(f.input), /privacy/)
  f.storage.getBucket = original
  f.files['tenant-branding']['../escape.png'] = Buffer.from('bad')
  await assert.rejects(backup(f.input), /Unsafe object path/)
})
test('Windows wrapped recovery key decrypts under the same account', { skip: process.platform !== 'win32' }, () => {
  const key = crypto.randomBytes(32), wrapped = protect(key)
  assert.notDeepEqual(wrapped, key); assert.deepEqual(protect(wrapped, true), key)
})
