/* eslint-disable @typescript-eslint/no-require-imports */
// Operator-only recovery inventory. Never writes to a database or storage.
const assert=require('node:assert/strict')
function reference(tenantId,source,bucket,asset){
 if(asset===null||asset===undefined)return null
 assert.ok(asset&&typeof asset==='object'&&!Array.isArray(asset),'Malformed saved asset reference')
 assert.ok(typeof tenantId==='string'&&/^[a-zA-Z0-9_-]+$/.test(tenantId))
 assert.ok(typeof asset.path==='string'&&asset.path.startsWith(tenantId+'/')&&asset.path.split('/').every(p=>/^[a-zA-Z0-9_.-]+$/.test(p)&&p!=='.'&&p!=='..'),'Unsafe or foreign-tenant asset reference')
 assert.ok(Number.isSafeInteger(asset.bytes)&&asset.bytes>0&&asset.bytes<=10*1024*1024,'Invalid referenced asset size')
 if(bucket==='tenant-documents'||asset.sha256!==undefined)assert.match(asset.sha256||'',/^[a-f0-9]{64}$/,'Missing or invalid referenced PDF checksum')
 return {tenantId,source,bucket,path:asset.path,bytes:asset.bytes,...(asset.sha256?{sha256:asset.sha256}:{})}
}
async function assetReferences(db){
 const operator=(await db.query('SELECT rolsuper OR rolbypassrls AS complete FROM pg_roles WHERE rolname=current_user')).rows[0]
 assert.equal(operator?.complete,true,'Recovery inventory requires complete database visibility')
 const refs=[],add=(t,s,b,a)=>{const r=reference(t,s,b,a);if(r)refs.push(r)}
 for(const r of(await db.query('SELECT "tenantId",branding FROM "AppSetting"')).rows){add(r.tenantId,'settings.document-logo','tenant-branding',r.branding?.logo?.document);add(r.tenantId,'settings.sidebar-logo','tenant-branding',r.branding?.logo?.sidebar)}
 for(const r of(await db.query('SELECT "tenantId",id,"invoiceBranding" b FROM "AppointmentOrder"')).rows)add(r.tenantId,'appointment:'+r.id,'tenant-branding',r.b?.logo)
 for(const r of(await db.query('SELECT "tenantId","quotationId",number,snapshot,"archivedPdf" archive FROM "CrmQuotationRevision"')).rows){add(r.tenantId,`quotation-logo:${r.quotationId}:${r.number}`,'tenant-branding',r.snapshot?.branding?.logo);add(r.tenantId,`quotation-pdf:${r.quotationId}:${r.number}`,'tenant-documents',r.archive)}
 // Recovery may inspect the reviewed pre-upgrade baseline. Absence is permitted
 // only for these newly registered tables; malformed existing references always fail closed.
 for(const [table,prefix] of [['SalesOrderDocument','order-document'],['OrderReceiptDocument','payment-receipt'],['CustomerInvoiceDocument','customer-invoice']]){
  const exists=(await db.query(`SELECT to_regclass('public."${table}"') IS NOT NULL AS present`)).rows[0].present
  if(exists)for(const r of(await db.query(`SELECT "tenantId",id,snapshot,archive FROM "${table}"`)).rows){add(r.tenantId,prefix+'-logo:'+r.id,'tenant-branding',r.snapshot?.payload?.branding?.logo);assert.ok(r.archive,'Issued PDF is missing its archive');add(r.tenantId,prefix+'-pdf:'+r.id,'tenant-documents',r.archive)}
 }
 const statutory=(await db.query('SELECT to_regclass(\'public."TaxStatutoryDocument"\') IS NOT NULL AS present')).rows[0].present
 if(statutory)for(const r of(await db.query('SELECT "tenantId",id,status,snapshot,"printArchive","signedArchive" FROM "TaxStatutoryDocument"')).rows){
  assert.ok(['RESERVED','PRINT_READY','ISSUED','VOID'].includes(r.status),'Unknown statutory signing state')
  if(['PRINT_READY','ISSUED'].includes(r.status))assert.ok(r.printArchive,'Prepared statutory PDF is missing its archive')
  if(r.status==='ISSUED')assert.ok(r.signedArchive,'Issued statutory document is missing its signed archive')
  add(r.tenantId,'statutory-logo:'+r.id,'tenant-branding',r.snapshot?.branding?.logo)
  add(r.tenantId,'statutory-print:'+r.id,'tenant-documents',r.printArchive)
  add(r.tenantId,'statutory-signed:'+r.id,'tenant-documents',r.signedArchive)
 }

 return refs.sort((a,b)=>Buffer.compare(Buffer.from(a.tenantId+'\0'+a.source+'\0'+a.path),Buffer.from(b.tenantId+'\0'+b.source+'\0'+b.path)))
}
function verifyReferences(refs,manifest){
 assert.ok(Array.isArray(manifest.buckets),'Storage manifest missing')
 for(const bucket of ['tenant-branding','tenant-documents']){const row=manifest.buckets.find(b=>b.bucket===bucket);assert.ok(row,'Required bucket missing');assert.equal(row.public,bucket==='tenant-branding','Bucket privacy mismatch')}
 const files=new Map()
 for(const b of manifest.buckets)for(const f of b.files){const key=b.bucket+'/'+f.path;assert.ok(!files.has(key),'Duplicate stored object');assert.match(f.sha256||'',/^[a-f0-9]{64}$/);files.set(key,f)}
 for(const r of refs){const f=files.get(r.bucket+'/'+r.path);assert.ok(f,'A saved database asset is missing from storage recovery');assert.equal(f.bytes,r.bytes,'Referenced asset size differs');if(r.sha256)assert.equal(f.sha256,r.sha256,'Referenced asset checksum differs')}
 return {references:refs.length,uniqueReferencedObjects:new Set(refs.map(r=>r.bucket+'/'+r.path)).size,verified:true}
}
module.exports={assetReferences,verifyReferences,reference}
