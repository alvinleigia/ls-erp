import { z } from 'zod'
import { validGstin } from '../localizations/india'

export const partyTaxOwnerSchema=z.object({kind:z.enum(['PERSON','BUSINESS']),id:z.string().trim().min(1).max(200)}).strict()
export type PartyTaxOwner=z.infer<typeof partyTaxOwnerSchema>
const text=(n:number)=>z.string().trim().max(n)
const details={legalName:text(200).min(1),addressLine1:text(300),addressLine2:text(300),city:text(100),postalCode:text(6).refine(v=>!v||/^[1-9][0-9]{5}$/.test(v),'Enter a six-digit PIN or leave it empty.'),regionCode:text(2).refine(v=>!v||/^(0[1-9]|[12][0-9]|3[0-8]|97)$/.test(v),'Choose a supported state/territory code.'),effectiveFrom:z.iso.date(),effectiveTo:z.iso.date().nullable(),archived:z.boolean(),reviewed:z.literal(true)}
const dates=(v:{effectiveFrom:string;effectiveTo:string|null})=>!v.effectiveTo||v.effectiveTo>=v.effectiveFrom
export const partyTaxCreateSchema=z.object({...details,scheme:z.literal('IN_GST'),status:z.enum(['REGISTERED','UNREGISTERED']),registrationNumber:text(15).transform(v=>v.toUpperCase()),category:z.enum(['REGULAR','COMPOSITION','SEZ_UNIT','SEZ_DEVELOPER','NOT_APPLICABLE'])}).strict().refine(dates,'Effective end must not precede the start.').superRefine((v,c)=>{
 if(v.archived)c.addIssue({code:'custom',message:'Create an active reviewed identity.'})
 if(v.status==='REGISTERED'&&(!validGstin(v.registrationNumber)||v.regionCode!==v.registrationNumber.slice(0,2)||v.category==='NOT_APPLICABLE'))c.addIssue({code:'custom',message:'Enter a structurally valid GSTIN, its matching state code and registration category.'})
 if(v.status==='UNREGISTERED'&&(v.registrationNumber!==''||v.category!=='NOT_APPLICABLE'))c.addIssue({code:'custom',message:'An unregistered assertion has no GSTIN or registration category.'})
})
export const partyTaxUpdateSchema=z.object({...details,category:z.enum(['REGULAR','COMPOSITION','SEZ_UNIT','SEZ_DEVELOPER','NOT_APPLICABLE']),version:z.number().int().positive()}).strict().refine(dates,'Effective end must not precede the start.')
export const partyTaxQuerySchema=z.object({page:z.coerce.number().int().min(1).default(1),pageSize:z.coerce.number().int().min(1).max(50).default(10),status:z.enum(['active','archived','all']).default('active')})
