/* eslint-disable @typescript-eslint/no-require-imports */
const {test,after}=require('node:test'),assert=require('node:assert/strict'),{createHash}=require('node:crypto')
const storage=require('../platform/storage/documents.ts'),originalFetch=global.fetch
after(()=>{global.fetch=originalFetch})
test('private PDFs use immutable paths, bounded sizes, short-lived signed downloads and explicit storage failures',async()=>{
 process.env.SUPABASE_URL='https://archivetest.supabase.co';process.env.SUPABASE_SECRET_KEY='sb_secret_test_only'
 const calls=[]
 global.fetch=async(url,options)=>{calls.push({url:String(url),options});return new Response(JSON.stringify(String(url).includes('/sign/')?{signedURL:'/object/sign/tenant-documents/file.pdf?token=synthetic'}:{Key:'file'}),{status:200,headers:{'content-type':'application/json'}})}
 const bytes=Buffer.from('%PDF-synthetic'),saved=await storage.uploadQuotationPdf('tenant_a','quote_a',1,bytes)
 assert.equal(saved.sha256,createHash('sha256').update(bytes).digest('hex'));assert.equal(saved.bytes,bytes.length)
 assert.match(saved.path,/^tenant_a\/quotations\/quote_a\/1\/.+\.pdf$/)
 assert.equal(new Headers(calls[0].options.headers).get('x-upsert'),'false')
 await storage.archivedPdfUrl(saved.path,'quotation.pdf')
 assert.equal(JSON.parse(calls[1].options.body).expiresIn,60)
 assert.ok(calls.every(c=>c.url.startsWith('https://archivetest.supabase.co/storage/v1/')))
 const documentId=require('node:crypto').randomUUID(),order=await storage.uploadOrderDocumentPdf('tenant_a','order_a',documentId,bytes)
 assert.match(order.path,new RegExp(`^tenant_a/orders/order_a/${documentId}/.+\\.pdf$`));assert.equal(order.sha256,saved.sha256)
 await storage.archivedPdfUrl(order.path,'allotment.pdf');await storage.removeUnusedPdf(order.path)
 const receipt=await storage.uploadReceiptDocumentPdf('tenant_a','payment_a',documentId,bytes);assert.match(receipt.path,new RegExp(`^tenant_a/receipts/payment_a/${documentId}/.+\\.pdf$`));await storage.archivedPdfUrl(receipt.path,'receipt.pdf');await storage.removeUnusedPdf(receipt.path);await assert.rejects(storage.uploadReceiptDocumentPdf('tenant_a','../outside',documentId,bytes))
 await assert.rejects(storage.uploadOrderDocumentPdf('tenant_a','../outside',documentId,bytes))
 await assert.rejects(storage.archivedPdfUrl('../other.pdf','file.pdf'))
 await assert.rejects(storage.uploadQuotationPdf('tenant_a','quote_a',1,Buffer.alloc(storage.DOCUMENT_LIMIT+1)),e=>e.status===413)
 global.fetch=async()=>new Response(JSON.stringify({message:'unavailable'}),{status:503,headers:{'content-type':'application/json'}})
 await assert.rejects(storage.uploadQuotationPdf('tenant_a','quote_a',1,bytes),e=>e.status===503)
})
