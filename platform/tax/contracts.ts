import { z } from 'zod'
import { validGstin } from './localizations/india'

const id=z.string().trim().min(1).max(200),text=(n:number)=>z.string().trim().max(n)
export const taxConfigurationQuery=z.object({page:z.coerce.number().int().min(1).default(1),pageSize:z.coerce.number().int().min(1).max(50).default(10),q:text(150).default(''),companyId:id.optional(),status:z.enum(['active','archived','all']).default('active')})
const registrationFields={label:text(100).min(1),legalName:text(200).min(1),addressLine1:text(300).min(1),addressLine2:text(300).default(''),city:text(100).min(1),postalCode:z.string().regex(/^[1-9][0-9]{5}$/),effectiveFrom:z.iso.date(),effectiveTo:z.iso.date().nullable(),category:z.enum(['REGULAR','COMPOSITION','SEZ_UNIT','SEZ_DEVELOPER']),eInvoicePolicy:z.enum(['UNASSESSED','REQUIRED','NOT_REQUIRED']).default('UNASSESSED'),archived:z.boolean().default(false),reviewed:z.literal(true)}
const dates=(d:{effectiveFrom:string;effectiveTo:string|null})=>!d.effectiveTo||d.effectiveTo>=d.effectiveFrom
export const registrationCreateSchema=z.object({...registrationFields,companyId:id,scheme:z.literal('IN_GST'),registrationNumber:text(15).transform(v=>v.toUpperCase()).refine(validGstin,'Enter a structurally valid regular GSTIN, including its check digit.')}).strict().refine(dates,'Effective end must not precede the start.')
export const registrationUpdateSchema=z.object({...registrationFields,version:z.number().int().positive()}).strict().refine(dates,'Effective end must not precede the start.')
export const officeTaxSchema=z.object({version:z.number().int().min(0),registrationId:id.nullable()}).strict()
export const componentCodes=['CGST','SGST','UTGST','IGST','CESS'] as const
const variant=z.object({key:z.enum(['INTRA_STATE','INTER_STATE']),components:z.array(z.object({code:z.enum(componentCodes),rateId:id}).strict()).min(1).max(3)}).strict()
export const taxProfileBodySchema=z.object({
 name:text(150).min(1),scheme:z.literal('IN_GST'),enabled:z.boolean(),supplyKind:z.enum(['GOODS','SERVICES','OTHER']),treatment:z.enum(['TAXABLE','NIL_RATED','EXEMPT','ZERO_RATED','NON_GST']),classificationKind:z.enum(['HSN','SAC','NONE']),classificationCode:text(12).regex(/^[0-9]*$/),basisReference:text(1000).default(''),priceBasis:z.enum(['INCLUSIVE','EXCLUSIVE']),zeroRatedMode:z.enum(['NOT_APPLICABLE','WITH_PAYMENT','WITHOUT_PAYMENT']),variants:z.array(variant).max(2),
}).strict().superRefine((d,ctx)=>{
 const error=(message:string)=>ctx.addIssue({code:'custom',message})
 if(new Set(d.variants.map(v=>v.key)).size!==d.variants.length)error('Choose each jurisdiction variant once.')
 if(d.classificationKind==='NONE'&&d.classificationCode||d.classificationKind!=='NONE'&&!/^[0-9]{4,8}$/.test(d.classificationCode))error('Choose a classification kind and its numeric code, or explicitly choose None.')
 if(d.treatment==='ZERO_RATED'?(d.zeroRatedMode==='NOT_APPLICABLE'):(d.zeroRatedMode!=='NOT_APPLICABLE'))error('Specify the zero-rated collection mode only for a zero-rated profile.')
 const charged=d.treatment==='TAXABLE'||d.treatment==='ZERO_RATED'&&d.zeroRatedMode==='WITH_PAYMENT'
 if(charged&&!d.variants.length)error('Configure at least one supported jurisdiction variant.')
 if(!charged&&d.variants.length)error('This treatment must not have charge components.')
 if(['EXEMPT','NON_GST'].includes(d.treatment)&&!d.basisReference)error('Record the approved basis for this treatment.')
 for(const v of d.variants){
  const codes=v.components.map(c=>c.code),set=new Set(codes)
  if(set.size!==codes.length)error('Use each component code once per variant.')
  if(v.key==='INTER_STATE'&&(!set.has('IGST')||codes.some(c=>!['IGST','CESS'].includes(c))))error('Inter-state variants use IGST and optional percentage CESS.')
  if(v.key==='INTRA_STATE'&&(!set.has('CGST')||Number(set.has('SGST'))+Number(set.has('UTGST'))!==1||set.has('IGST')))error('Intra-state variants use CGST and either SGST or UTGST, with optional percentage CESS.')
  if(d.treatment==='ZERO_RATED'&&v.key!=='INTER_STATE')error('A zero-rated collection profile must use its explicit inter-state variant.')
 }
})
export const taxProfilePublishSchema=z.object({companyId:id,id:id.optional(),code:z.string().trim().toUpperCase().regex(/^[A-Z0-9][A-Z0-9_-]{0,39}$/),version:z.number().int().min(0),reviewed:z.literal(true),body:taxProfileBodySchema}).strict()
export type TaxProfileInput=z.infer<typeof taxProfileBodySchema>
export type TaxProfileSnapshot=Omit<TaxProfileInput,'variants'>&{format:1;variants:{key:'INTRA_STATE'|'INTER_STATE';components:{code:typeof componentCodes[number];rateId:string;name:string;percent:string;sourceUpdatedAt:string}[]}[]}
