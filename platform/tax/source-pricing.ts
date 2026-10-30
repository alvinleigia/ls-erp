import { z } from 'zod'
import { allocateMinor } from './arithmetic'
import { calculateTaxAgreement,moneyMinor,moneyText,type TaxAgreement } from './agreement'
import { previewProfileSnapshotSchema } from './agreement-preview'

export const taxPricingApprovalSchema=z.object({revision:z.number().int().positive(),reviewId:z.string().min(1).max(200),expectedGross:z.string().regex(/^\d+\.\d{2}$/),basisReference:z.string().trim().min(10).max(1000),reviewed:z.literal(true)}).strict()
type Source={currency:string;consideration:string;discount:string;charges:unknown[];lines:{amount:string}[]}
type Saved={lineIndex:number;variant:string;profileSnapshot:unknown}
// Quoted prices stay fixed. Reconcile, never infer a second tax charge or amend
// the source. Discount shares use source-line order for deterministic ties.
export function sourceTaxPricing(source:Source,saved:Saved[]):{agreement:TaxAgreement|null;reason:string;gross:string|null}{
 if(source.currency!=='INR')return {agreement:null,gross:null,reason:'India GST pricing approval currently requires INR. Foreign-currency tax conversion needs its own reviewed contract.'}
 if(source.charges.length)return {agreement:null,gross:null,reason:'Commercial charges require explicit tax classification in a replacement quotation. Charge labels are never treated as tax components.'}
 const amounts=source.lines.map(l=>moneyMinor(l.amount,2)),discount=moneyMinor(source.discount,2)
 if(discount>amounts.reduce((a,b)=>a+b,0))throw new RangeError('Discount exceeds the saved line amounts.')
 const shares=allocateMinor(discount,amounts)
 if(saved.length!==amounts.length)throw new RangeError('Review every source line exactly once.')
 const agreement=calculateTaxAgreement({currency:source.currency,minorDigits:2,lines:amounts.map((amountMinor,i)=>{
  const entry=saved.find(v=>v.lineIndex===i);if(!entry)throw new RangeError('Missing reviewed source line.')
  const p=previewProfileSnapshotSchema.parse(entry.profileSnapshot),variant=p.variants.find(v=>v.key===entry.variant)
  if(p.variants.length?!variant:entry.variant!=='NONE')throw new RangeError('Unconfigured tax variant.')
  return {key:String(i),amountMinor,discountMinor:shares[i],priceBasis:p.priceBasis,components:variant?.components.map(c=>({code:c.code,percent:c.percent}))||[]}
 })}),gross=moneyText(agreement.grossMinor,2)
 return {agreement,gross,reason:agreement.grossMinor===moneyMinor(source.consideration,2)?'':'Calculated tax-inclusive total differs from the saved agreement. Correct the quotation or its reviewed pricing profile in a new revision; approval cannot change the agreed amount.'}
}
