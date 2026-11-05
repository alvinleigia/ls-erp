/* eslint-disable @typescript-eslint/no-require-imports */
const {test}=require('node:test'),assert=require('node:assert/strict')
const {companyDocumentSettingsSchema,resolveCompanyDocumentContent}=require('../platform/companies/document-settings.ts')
const {orderAcknowledgement}=require('../modules/sales-orders/document-provider.ts')
const {statutoryTemplateTypes}=require('../platform/tax/localizations/india-statutory-pdf.ts')
test('company defaults are bounded presentation and payment instructions, without customer or executable fields',()=>{
 const value=companyDocumentSettingsSchema.parse({});assert.equal(value.address,'');assert.equal(value.bank.accountNumber,'')
 for(const patch of [{address:'x'.repeat(1501)},{website:'javascript:alert(1)'},{footer:'a\nb\nc\nd'},{bank:{password:'secret'}},{customerAddress:'private'}])assert.equal(companyDocumentSettingsSchema.safeParse(patch).success,false)
})
test('company details are opt-in, cloned into new content, and never replace accepted bank instructions',()=>{
 const original={...orderAcknowledgement.defaults,address:'Template address'},settings=companyDocumentSettingsSchema.parse({address:'Company address',contact:'Office contact',footer:'Company footer',signatory:'Accounts office',bank:{accountNumber:'1234'}})
 assert.equal(resolveCompanyDocumentContent(original,settings),original)
 const resolved=resolveCompanyDocumentContent({...original,useCompanyDetails:true},settings)
 assert.equal(resolved.address,'Company address');assert.equal(resolved.contact,'Office contact');assert.equal(resolved.appearance.footer,'Company footer');assert.equal(resolved.signatory,'Accounts office')
 settings.address='Changed later';assert.equal(resolved.address,'Company address');assert.equal(original.address,'Template address');assert.equal(Object.hasOwn(resolved,'bank'),false)
 assert(statutoryTemplateTypes.every(provider=>provider.companyDetails===false))
})
