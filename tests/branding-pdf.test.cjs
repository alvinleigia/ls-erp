/* eslint-disable @typescript-eslint/no-require-imports */
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),sharp=require('sharp'),{PDFDocument,PDFName,PDFDict}=require('pdf-lib')
const storagePath=path.resolve(__dirname,'../platform/branding/storage.ts')
let savedLogo,requested=[]
require.cache[storagePath]={id:storagePath,filename:storagePath,loaded:true,exports:{downloadDocumentLogo:async p=>{requested.push(p);return savedLogo}}}
const {buildQuotationPdf}=require('../modules/sales-documents/quotation-pdf.ts'),{buildAppointmentOrderInvoicePdf}=require('../modules/appointments/invoice-pdf.ts')
const {emptyQuotationContent}=require('../modules/sales-documents/quotation-validation.ts'),{calculateQuotation}=require('../modules/sales-documents/quotation-calculation.ts')
test('PDF renderers embed the document logo without changing financial totals',async()=>{
 savedLogo=await sharp(Buffer.from('<svg width="1200" height="400" xmlns="http://www.w3.org/2000/svg"><rect x="20" y="100" width="160" height="160" rx="25" fill="#135b78"/><text x="220" y="215" font-family="Arial" font-weight="bold" font-size="80" fill="#135b78">QA INDUSTRIES</text><text x="225" y="275" font-family="Arial" font-size="30" fill="#444">SYNTHETIC TEST BRAND</text></svg>')).png().toBuffer()
 const content={...structuredClone(emptyQuotationContent),supplierName:'QA Industries',title:'Quotation',currency:'INR',lines:[{description:'Consulting service',quantity:'1',unit:'service',rate:'1000'}]}
 const record={id:'QA-001',revision:1,revisionCreatedAt:'2026-10-19',snapshot:{content,calculation:calculateQuotation(content),context:[],customer:{name:'Test Customer',email:null,phone:null},opportunity:'Test opportunity',locale:'en-IN',dateFormat:'dd/MM/yyyy',numberFormat:'US_UK',currencySymbolPlacement:'BEFORE',branding:{name:'QA Industries',logo:{path:'saved-original/document.png',width:1200,height:400,bytes:savedLogo.length}}}}
 const before=JSON.stringify(record),quote=await buildQuotationPdf(record)
 assert.deepEqual(requested,['saved-original/document.png']);assert.equal(JSON.stringify(record),before)
 const order={id:'QA-ORDER',appointmentStartAt:'2026-10-19T10:00:00Z',customer:{name:'Test Customer'},lines:[{service:{name:'Consulting'},quantity:1,unitPriceCents:100000,lineTaxCents:0,lineTotalCents:100000,taxMode:'EXCLUSIVE'}],taxes:[],totalCents:100000,taxCents:0,couponDiscountCents:0,lineDiscountCents:0}
 const invoice=await buildAppointmentOrderInvoicePdf({order,businessName:'QA Industries',logo:savedLogo,settings:{currency:'INR',locale:'en-IN',timeZone:'Asia/Kolkata',dateFormat:'dd/MM/yyyy'}})
 for(const bytes of [quote,invoice]){const doc=await PDFDocument.load(bytes);assert.ok(doc.getPages()[0].node.Resources().lookup(PDFName.of('XObject'),PDFDict).keys().length>0)}
 fs.mkdirSync('tmp/branding-qa',{recursive:true});fs.writeFileSync('tmp/branding-qa/quotation.pdf',quote);fs.writeFileSync('tmp/branding-qa/invoice.pdf',invoice)
 content.logoDataUrl='data:image/png;base64,'+savedLogo.toString('base64');await buildQuotationPdf(record);assert.equal(requested.length,1,'Explicit document override takes precedence')
})
