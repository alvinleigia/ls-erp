import { z } from 'zod'
import { componentCodes,taxProfileBodySchema } from './contracts'
import { taxRateInputSchema } from './rate-input'
import { calculateTaxAgreement,allocateTaxPortion,addTaxPortions,moneyMinor,moneyText,type TaxPortion } from './agreement'

const savedComponent=z.object({code:z.enum(componentCodes),rateId:z.string().min(1),name:z.string(),percent:taxRateInputSchema,sourceUpdatedAt:z.iso.datetime()}).strict()
export const previewProfileSnapshotSchema=taxProfileBodySchema.safeExtend({format:z.literal(1),variants:z.array(z.object({key:z.enum(['INTRA_STATE','INTER_STATE']),components:z.array(savedComponent).min(1).max(3)}).strict()).max(2)})
export const profilePreviewSchema=z.object({version:z.number().int().positive(),currency:z.string().regex(/^[A-Z]{3}$/).refine(v=>Intl.supportedValuesOf('currency').includes(v),'Choose a supported currency.'),amount:z.string().trim().min(1).max(60),discount:z.string().trim().min(1).max(60),variant:z.enum(['NONE','INTRA_STATE','INTER_STATE']),firstPortion:z.string().trim().min(1).max(60).nullable()}).strict()

export function calculateProfilePreview(snapshot:unknown,input:unknown){
 const profile=previewProfileSnapshotSchema.parse(snapshot),data=profilePreviewSchema.parse(input),minorDigits=new Intl.NumberFormat('en',{style:'currency',currency:data.currency}).resolvedOptions().maximumFractionDigits??2
 const selected=profile.variants.find(v=>v.key===data.variant)
 if(profile.variants.length?!selected:data.variant!=='NONE')throw new RangeError('Choose a jurisdiction variant configured on this saved profile.')
 const calculation=calculateTaxAgreement({currency:data.currency,minorDigits,lines:[{key:'preview',amountMinor:moneyMinor(data.amount,minorDigits),discountMinor:moneyMinor(data.discount,minorDigits),priceBasis:profile.priceBasis,components:selected?.components.map(c=>({code:c.code,percent:c.percent}))||[]}]})
 const line=calculation.lines[0],first=data.firstPortion===null?null:allocateTaxPortion(line,undefined,moneyMinor(data.firstPortion,minorDigits)),remaining=first?allocateTaxPortion(line,first,line.grossMinor-first.grossMinor):null
 // Exercise the same cumulative contract that future persisted allocations use.
 if(first&&remaining){const total=addTaxPortions(first,remaining);if(total.grossMinor!==line.grossMinor||total.netMinor!==line.netMinor||total.taxMinor!==line.taxMinor)throw new RangeError('Partial tax allocation does not reconcile.')}
 const display=(p:Pick<TaxPortion,'netMinor'|'taxMinor'|'grossMinor'|'components'>)=>({net:moneyText(p.netMinor,minorDigits),tax:moneyText(p.taxMinor,minorDigits),gross:moneyText(p.grossMinor,minorDigits),components:p.components.map(c=>({code:c.code,amount:moneyText(c.amountMinor,minorDigits)}))})
 return {calculation,first,remaining,display:{total:display(line),first:first?display(first):null,remaining:remaining?display(remaining):null}}
}
export type TaxProfilePreviewData=ReturnType<typeof calculateProfilePreview>&{profileId:string;profileVersion:number;profileEnabled:boolean;companyArchived:boolean;sourceRatesChanged:boolean}
