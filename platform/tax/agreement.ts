import { z } from 'zod'
import { allocateMinor,decimalText,inclusiveTaxMinor,percentageMinor } from './arithmetic'
import { taxRateInputSchema } from './rate-input'

// Calculation policy, not statutory eligibility or source authorization. Callers
// supply approved line values/discounts and resolved percentage components.
const minor=z.number().int().min(0).max(Number.MAX_SAFE_INTEGER)
const code=z.string().regex(/^[A-Z][A-Z0-9_]{0,39}$/)
const component=z.object({code,percent:taxRateInputSchema}).strict()
export const agreementLineSchema=z.object({key:z.string().min(1).max(100),amountMinor:minor,discountMinor:minor,priceBasis:z.enum(['INCLUSIVE','EXCLUSIVE']),components:z.array(component).max(10)}).strict().superRefine((v,c)=>{
 if(v.discountMinor>v.amountMinor)c.addIssue({code:'custom',message:'Discount cannot exceed the line amount.'})
 if(new Set(v.components.map(x=>x.code)).size!==v.components.length)c.addIssue({code:'custom',message:'Each tax component must have a unique code.'})
})
export const agreementSchema=z.object({currency:z.string().regex(/^[A-Z]{3}$/),minorDigits:z.number().int().min(0).max(6),lines:z.array(agreementLineSchema).min(1).max(100)}).strict().refine(v=>new Set(v.lines.map(l=>l.key)).size===v.lines.length,'Each agreement line must have a unique key.')
export type TaxAgreementInput=z.input<typeof agreementSchema>
export type TaxAgreementLine={key:string;amountMinor:number;discountMinor:number;priceBasis:'INCLUSIVE'|'EXCLUSIVE';netMinor:number;taxMinor:number;grossMinor:number;components:{code:string;percent:string;amountMinor:number}[]}
export type TaxAgreement={format:1;rounding:'LINE_EXACT_V1';currency:string;minorDigits:number;lines:TaxAgreementLine[];netMinor:number;taxMinor:number;grossMinor:number;discountMinor:number}
export type TaxPortion={key:string;netMinor:number;taxMinor:number;grossMinor:number;components:{code:string;amountMinor:number}[]}
function safe(v:bigint){if(v<0||v>BigInt(Number.MAX_SAFE_INTEGER))throw new RangeError('Calculated agreement exceeds the supported minor-unit limit.');return Number(v)}
const sum=(values:readonly number[])=>safe(values.reduce((s,v)=>s+BigInt(v),BigInt(0)))
const byCode=(a:{code:string},b:{code:string})=>a.code<b.code?-1:a.code>b.code?1:0

function line(input:z.output<typeof agreementLineSchema>):TaxAgreementLine{
 const components=input.components.map(c=>({...c,percent:decimalText(c.percent)})).sort(byCode),discounted=input.amountMinor-input.discountMinor
 let netMinor=discounted,amounts:number[]
 if(input.priceBasis==='INCLUSIVE'){
  const tax=inclusiveTaxMinor(discounted,components.map(c=>c.percent));netMinor=discounted-tax
  amounts=allocateMinor(tax,components.map(c=>c.percent))
 }else amounts=components.map(c=>percentageMinor(netMinor,c.percent))
 const taxMinor=sum(amounts),grossMinor=sum([netMinor,taxMinor])
 return {key:input.key,amountMinor:input.amountMinor,discountMinor:input.discountMinor,priceBasis:input.priceBasis,netMinor,taxMinor,grossMinor,components:components.map((c,i)=>({...c,amountMinor:amounts[i]}))}
}
export function calculateTaxAgreement(input:unknown):TaxAgreement{
 const parsed=agreementSchema.parse(input),lines=parsed.lines.map(line)
 return {format:1,rounding:'LINE_EXACT_V1',currency:parsed.currency,minorDigits:parsed.minorDigits,lines,netMinor:sum(lines.map(l=>l.netMinor)),taxMinor:sum(lines.map(l=>l.taxMinor)),grossMinor:sum(lines.map(l=>l.grossMinor)),discountMinor:sum(lines.map(l=>l.discountMinor))}
}

const portionSchema=z.object({key:z.string(),netMinor:minor,taxMinor:minor,grossMinor:minor,components:z.array(z.object({code,amountMinor:minor}).strict()).max(10)}).strict()
// Allocate from the remaining frozen component balances, never current rates.
// Independent cumulative rounding can produce negative one-cent portions;
// remaining-balance apportionment stays non-negative and the final bill absorbs
// the exact remainder. Persist actual portions before using them as prior totals.
export function allocateTaxPortion(frozen:TaxAgreementLine,previous:TaxPortion|undefined,grossMinor:number):TaxPortion{
 minor.parse(grossMinor)
 const expected=line(agreementLineSchema.parse({key:frozen.key,amountMinor:frozen.amountMinor,discountMinor:frozen.discountMinor,priceBasis:frozen.priceBasis,components:frozen.components.map(c=>({code:c.code,percent:c.percent}))}))
 if(frozen.netMinor!==expected.netMinor||frozen.taxMinor!==expected.taxMinor||frozen.grossMinor!==expected.grossMinor||frozen.components.length!==expected.components.length||frozen.components.some((c,i)=>c.code!==expected.components[i].code||c.percent!==expected.components[i].percent||c.amountMinor!==expected.components[i].amountMinor))throw new RangeError('Frozen tax line does not match its calculation policy.')
 const prior=previous?portionSchema.parse(previous):{key:frozen.key,netMinor:0,taxMinor:0,grossMinor:0,components:frozen.components.map(c=>({code:c.code,amountMinor:0}))}
 if(prior.key!==frozen.key||prior.components.length!==frozen.components.length||new Set(prior.components.map(c=>c.code)).size!==prior.components.length)throw new RangeError('Prior tax allocation must identify every frozen component exactly once.')
 const components=frozen.components.map(c=>{const before=prior.components.find(p=>p.code===c.code);if(!before||before.amountMinor>c.amountMinor)throw new RangeError('Prior component allocation exceeds the frozen agreement.');return {...c,remaining:c.amountMinor-before.amountMinor}})
 if(prior.netMinor>frozen.netMinor||prior.taxMinor!==sum(prior.components.map(c=>c.amountMinor))||prior.grossMinor!==sum([prior.netMinor,prior.taxMinor])||prior.grossMinor>frozen.grossMinor)throw new RangeError('Prior tax allocation is inconsistent with the frozen agreement.')
 if(grossMinor>frozen.grossMinor-prior.grossMinor)throw new RangeError('Tax allocation exceeds the remaining agreement.')
 // The net bucket precedes canonical component codes for deterministic ties.
 const amounts=allocateMinor(grossMinor,[frozen.netMinor-prior.netMinor,...components.map(c=>c.remaining)]),netMinor=amounts[0],taxMinor=sum(amounts.slice(1))
 return {key:frozen.key,netMinor,taxMinor,grossMinor,components:components.map((c,i)=>({code:c.code,amountMinor:amounts[i+1]}))}
}
export function addTaxPortions(a:TaxPortion,b:TaxPortion):TaxPortion{
 const left=portionSchema.parse(a),right=portionSchema.parse(b)
 if(left.key!==right.key||left.components.length!==right.components.length||new Set(left.components.map(c=>c.code)).size!==left.components.length||new Set(right.components.map(c=>c.code)).size!==right.components.length)throw new RangeError('Combine allocations only for the same line and component set.')
 for(const p of [left,right])if(p.taxMinor!==sum(p.components.map(c=>c.amountMinor))||p.grossMinor!==sum([p.netMinor,p.taxMinor]))throw new RangeError('Tax portion totals are inconsistent.')
 return {key:left.key,netMinor:sum([left.netMinor,right.netMinor]),taxMinor:sum([left.taxMinor,right.taxMinor]),grossMinor:sum([left.grossMinor,right.grossMinor]),components:left.components.map(c=>{const other=right.components.find(x=>x.code===c.code);if(!other)throw new RangeError('Tax component sets differ.');return {code:c.code,amountMinor:sum([c.amountMinor,other.amountMinor])}}).sort(byCode)}
}

function digits(value:number){if(!Number.isInteger(value)||value<0||value>6)throw new RangeError('Unsupported currency minor-unit precision.');return value}
export function moneyMinor(value:string,minorDigits:number):number{
 digits(minorDigits);const match=/^(\d+)(?:\.(\d+))?$/.exec(value.trim());if(!match||value.length>100)throw new RangeError('Enter a non-negative decimal monetary amount.')
 const fraction=(match[2]||'').replace(/0+$/,'');if(fraction.length>minorDigits)throw new RangeError('Amount exceeds the currency minor-unit precision; it was not rounded.')
 return safe(BigInt(match[1])*BigInt(10)**BigInt(minorDigits)+BigInt(fraction.padEnd(minorDigits,'0')||'0'))
}
export function moneyText(amountMinor:number,minorDigits:number):string{
 minor.parse(amountMinor);digits(minorDigits);const s=String(amountMinor).padStart(minorDigits+1,'0');return minorDigits?s.slice(0,-minorDigits)+'.'+s.slice(-minorDigits):s
}
