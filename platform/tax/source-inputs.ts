import { z } from 'zod'
import { previewProfileSnapshotSchema } from './agreement-preview'
import { calculateTaxAgreement,moneyMinor,moneyText } from './agreement'

const id=z.string().trim().min(1).max(200),version=z.number().int().positive()
export const taxInputQuery=z.object({revision:z.coerce.number().int().positive(),page:z.coerce.number().int().min(1).max(100000).default(1),pageSize:z.coerce.number().int().min(1).max(50).default(10),q:z.string().trim().max(150).default(''),selectedId:id.optional(),kind:z.enum(['profiles','recipients']).optional()})
export const taxInputSaveSchema=z.object({revision:version,mappingVersion:version,issuerId:id,issuerVersion:version,recipientId:id,recipientVersion:version,proposedSupplyOn:z.iso.date(),reviewed:z.literal(true),lines:z.array(z.object({lineIndex:z.number().int().min(0).max(29),profileId:id,profileVersion:version,variant:z.enum(['NONE','INTRA_STATE','INTER_STATE']),placeCountryCode:z.literal('IN'),placeRegionCode:z.string().regex(/^(0[1-9]|[12][0-9]|3[0-8]|97)$/),placeBasis:z.string().trim().min(10).max(1000)}).strict()).min(1).max(30)}).strict().refine(v=>new Set(v.lines.map(l=>l.lineIndex)).size===v.lines.length,'Review each source line once.')
export type TaxInputSave=z.infer<typeof taxInputSaveSchema>

export function withinTaxDates(date:string,source:{effectiveFrom:Date;effectiveTo:Date|null}){return date>=source.effectiveFrom.toISOString().slice(0,10)&&(!source.effectiveTo||date<=source.effectiveTo.toISOString().slice(0,10))}

// An illustration from immutable source values and reviewed profile snapshots.
// This does not approve a taxable value, jurisdiction, price amendment or invoice.
export function taxInputIllustration(source:{currency:string;consideration:string;discount:string;charges:unknown[];lines:{amount:string}[]},saved:{lineIndex:number;variant:string;profileSnapshot:unknown}[]){
 if(source.charges.length||!/^0+(?:\.0+)?$/.test(source.discount))return {calculation:null,difference:null,reason:'Commercial discounts or charges need explicit tax/pricing review. They were not reclassified or included in this illustration.'}
 const minorDigits=new Intl.NumberFormat('en',{style:'currency',currency:source.currency}).resolvedOptions().maximumFractionDigits??2
 if(saved.length!==source.lines.length)throw new RangeError('Every source line requires reviewed tax inputs.')
 const lines=source.lines.map((l,index)=>{const entry=saved.find(v=>v.lineIndex===index);if(!entry)throw new RangeError('A source line is missing.');const p=previewProfileSnapshotSchema.parse(entry.profileSnapshot),variant=p.variants.find(v=>v.key===entry.variant);if(p.variants.length?!variant:entry.variant!=='NONE')throw new RangeError('This variant is not in the reviewed profile.');return {key:String(index),amountMinor:moneyMinor(l.amount,minorDigits),discountMinor:0,priceBasis:p.priceBasis,components:variant?.components.map(c=>({code:c.code,percent:c.percent}))||[]}})
 const calculation=calculateTaxAgreement({currency:source.currency,minorDigits,lines}),delta=calculation.grossMinor-moneyMinor(source.consideration,minorDigits)
 return {calculation,difference:(delta<0?'-':'')+moneyText(Math.abs(delta),minorDigits),reason:'Illustration only. Tax-aware pricing approval and order acceptance remain required.'}
}
