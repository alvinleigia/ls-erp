import { z } from 'zod'
import { validGstin } from './india'
import type { InvoiceTaxAllocation } from '../invoice-allocation'
import { previewProfileSnapshotSchema } from '../agreement-preview'

export const gstStates:Record<string,string>={
 '01':'Jammu and Kashmir','02':'Himachal Pradesh','03':'Punjab','04':'Chandigarh','05':'Uttarakhand','06':'Haryana','07':'Delhi','08':'Rajasthan','09':'Uttar Pradesh','10':'Bihar','11':'Sikkim','12':'Arunachal Pradesh','13':'Nagaland','14':'Manipur','15':'Mizoram','16':'Tripura','17':'Meghalaya','18':'Assam','19':'West Bengal','20':'Jharkhand','21':'Odisha','22':'Chhattisgarh','23':'Madhya Pradesh','24':'Gujarat','26':'Dadra and Nagar Haveli and Daman and Diu','27':'Maharashtra','29':'Karnataka','30':'Goa','31':'Lakshadweep','32':'Kerala','33':'Tamil Nadu','34':'Puducherry','35':'Andaman and Nicobar Islands','36':'Telangana','37':'Andhra Pradesh','38':'Ladakh','97':'Other Territory',
}
const id=z.string().trim().min(1).max(200),text=(n:number)=>z.string().trim().max(n),basis=text(2000).min(30)
export const statutoryKind=z.enum(['TAX_INVOICE','BILL_OF_SUPPLY','CREDIT_NOTE'])
export type StatutoryKind=z.infer<typeof statutoryKind>
export const statutorySeriesQuery=z.object({page:z.coerce.number().int().min(1).max(100000).default(1),q:text(100).default(''),kind:statutoryKind,selected:id.optional()}).strict()
export const statutorySeriesSchema=z.object({id:id.optional(),version:z.number().int().min(0),registrationId:id,financialYear:z.number().int().min(2000).max(9998),code:z.string().trim().toUpperCase().regex(/^[A-Z][A-Z0-9]{0,3}$/),kind:statutoryKind,enabled:z.boolean(),reviewed:z.literal(true)}).strict()
export const statutoryFactsSchema=z.object({
 kind:statutoryKind,issueOn:z.iso.date(),seriesId:id,seriesVersion:z.number().int().positive(),signatureMode:z.enum(['MANUAL','ELECTRONIC']),signatory:text(200).min(1),
 domestic:z.literal(true),reverseCharge:z.literal(false),dynamicQrNotRequired:z.literal(true),complianceBasis:basis,taxPointOn:z.iso.date(),timingBasis:basis,
 deliveryAddress:text(1500).min(10),deliveryState:text(2).refine(v=>!!gstStates[v],'Choose a supported India state/territory code.'),
 lines:z.array(z.object({lineIndex:z.number().int().min(0).max(29),quantity:z.string().regex(/^(?:0|[1-9]\d{0,11})(?:\.\d{1,6})?$/).nullable(),unit:text(30)}).strict()).min(1).max(30),
}).strict().refine(v=>new Set(v.lines.map(l=>l.lineIndex)).size===v.lines.length,'Review each billed line once.')
export type StatutoryFacts=z.infer<typeof statutoryFactsSchema>
export const statutoryReviewSchema=z.object({version:z.number().int().min(0),sourceVersion:z.number().int().positive(),body:statutoryFactsSchema,reviewed:z.literal(true)}).strict()
export const statutoryPrepareSchema=z.object({reviewId:id}).strict()
export const statutoryReserveSchema=statutoryPrepareSchema.extend({requestKey:z.uuid(),fingerprint:z.string().regex(/^[a-f0-9]{64}$/)}).strict()
export const statutoryCompleteSchema=z.object({version:z.number().int().positive(),signedOn:z.iso.date(),confirmedManualSignature:z.literal(true),basis:text(2000).min(20)}).strict()
export const statutoryVoidSchema=z.object({version:z.number().int().positive(),reason:text(2000).min(10)}).strict()
export type StatutoryAccepted={issuer:Record<string,unknown>;recipient:Record<string,unknown>;lines:{lineIndex:number;profileSnapshot:unknown;variant:string;placeRegionCode:string;placeBasis:string}[]}
export type StatutorySource={status:string;version:number;currency:string;invoiceDate:string;tax:InvoiceTaxAllocation;accepted:StatutoryAccepted;original?:{id:string;status:string;reference:string;issueOn:string;kind:string}|null}
export function gstFinancialYear(date:string){const [year,month]=date.split('-').map(Number);return month>=4?year:year-1}
export function gstDocumentNumber(code:string,year:number,serial:number){if(!/^[A-Z][A-Z0-9]{0,3}$/.test(code)||!Number.isInteger(year)||year<2000||year>9998||!Number.isInteger(serial)||serial<1||serial>999999)throw new RangeError('Invalid GST document series or exhausted counter.');return `${code}/${String(year).slice(-2)}${String(year+1).slice(-2)}/${String(serial).padStart(6,'0')}`}
// This is a bounded readiness check, never automated legal/tax eligibility.
// The human review records that basis, including signing and QR/IRP applicability.
export function statutoryReadiness(source:StatutorySource,facts:StatutoryFacts,today:string):string[]{
 const errors:string[]=[],{issuer,recipient}=source.accepted,credit=facts.kind==='CREDIT_NOTE'
 if(source.currency!=='INR'||source.tax.policy!=='REMAINING_BALANCE_V1')errors.push('A supported frozen INR tax allocation is required.')
 if(source.status!==(credit?'CREDITED':'POSTED'))errors.push(credit?'Use a fully credited invoice.':'Post the internal invoice before statutory preparation.')
 if(facts.issueOn!==today)errors.push('New statutory preparation uses today in the tenant time zone; backdating is not supported.')
 if(facts.taxPointOn>facts.issueOn)errors.push('The reviewed supply/tax point cannot follow the document date.')
 if(credit&&(!source.original||source.original.status!=='ISSUED'||source.original.kind==='CREDIT_NOTE'))errors.push('Complete the signed original statutory invoice/bill of supply before preparing its credit note.')
 if(!validGstin(String(issuer.registrationNumber||''))||!gstStates[String(issuer.regionCode)])errors.push('The frozen issuer needs a valid GSTIN and supported state code.')
 if(issuer.eInvoicePolicy!=='NOT_REQUIRED')errors.push('E-invoice applicability must be reviewed as Not required. Required/Unassessed cases need a connected IRP workflow.')
 for(const [name,p] of [['Issuer',issuer],['Recipient',recipient]] as const){if(['legalName','addressLine1','city','postalCode','regionCode'].some(k=>!String(p[k]||'').trim()))errors.push(`${name} name, address, PIN and state are required in the frozen identity.`);if(!gstStates[String(p.regionCode)])errors.push(`${name} state code is unsupported.`);for(const date of [facts.issueOn,facts.taxPointOn])if(date<String(p.effectiveFrom).slice(0,10)||p.effectiveTo&&date>String(p.effectiveTo).slice(0,10))errors.push(`${name} validity must cover document and supply dates.`)}
 if(recipient.status==='REGISTERED'&&!validGstin(String(recipient.registrationNumber)))errors.push('The frozen registered recipient needs a valid GSTIN.')
 if(!['REGISTERED','UNREGISTERED'].includes(String(recipient.status)))errors.push('Explicitly review the recipient as registered or unregistered in the source.')
 if(['SEZ_UNIT','SEZ_DEVELOPER'].includes(String(issuer.category))||['SEZ_UNIT','SEZ_DEVELOPER'].includes(String(recipient.category)))errors.push('SEZ/export documentation is outside the supported domestic workflow.')
 const actual=source.tax.lines.map(l=>Number(l.key));if(facts.lines.length!==actual.length||facts.lines.some(l=>!actual.includes(l.lineIndex)))errors.push('Review every billed line exactly once.')
 const profiles=actual.map(index=>{const input=source.accepted.lines.find(l=>l.lineIndex===index);if(!input||!gstStates[input.placeRegionCode]){errors.push('Every billed line needs supported frozen place-of-supply evidence.');return null}const p=previewProfileSnapshotSchema.safeParse(input.profileSnapshot);if(!p.success){errors.push('A reviewed frozen supply profile is missing.');return null}return {index,profile:p.data}})
 for(const row of profiles){if(!row)continue;const p=row.profile,line=facts.lines.find(l=>l.lineIndex===row.index);if(!['GOODS','SERVICES'].includes(p.supplyKind))errors.push('Classify each supply explicitly as goods or services.');if(p.classificationKind==='NONE'||!/^(?:\d{6}|\d{8})$/.test(p.classificationCode)||p.supplyKind==='SERVICES'&&p.classificationKind!=='SAC'||p.supplyKind==='GOODS'&&p.classificationKind!=='HSN')errors.push('This release requires reviewed six/eight-digit HSN or six-digit SAC classification.');if(p.supplyKind==='SERVICES'&&p.classificationCode.length!==6)errors.push('Service SAC must have six digits.');if(p.supplyKind==='GOODS'&&(!line?.quantity||!/[1-9]/.test(line.quantity)||!line.unit.trim()))errors.push('Record actual supplied quantity and unit for goods; equivalent billing shares are not actual dispatch quantities.');if(facts.kind==='TAX_INVOICE'&&p.treatment!=='TAXABLE')errors.push('Use a tax invoice only for uniformly taxable supplies.');if(facts.kind==='BILL_OF_SUPPLY'&&!['NIL_RATED','EXEMPT'].includes(p.treatment))errors.push('Bill of supply currently supports uniformly nil-rated/exempt supplies.');if(['ZERO_RATED','NON_GST'].includes(p.treatment))errors.push('Export/zero-rated/non-GST documents require a separate supported workflow.')}
 if(facts.kind==='TAX_INVOICE'&&issuer.category!=='REGULAR')errors.push('A regular issuer registration is required for a tax invoice.')
 if(facts.kind==='BILL_OF_SUPPLY'&&source.tax.taxMinor!==0)errors.push('A bill of supply cannot collect tax.')
 return [...new Set(errors)]
}
