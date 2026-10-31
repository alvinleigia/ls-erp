import { allocateTaxPortion,addTaxPortions,moneyMinor,type TaxAgreement,type TaxPortion } from './agreement'

export type InvoiceTaxAllocation={format:1;policy:'REMAINING_BALANCE_V1';orderId:string;approvalId:string;currency:string;minorDigits:number;netMinor:number;taxMinor:number;grossMinor:number;lines:TaxPortion[]}
// Prior values are actual active draft/posting reservations; cancelled/credited
// sources are excluded by the owning invoice module. No master lookups here.
export function allocateInvoiceTax(agreement:TaxAgreement,source:{orderId:string;approvalId:string},prior:InvoiceTaxAllocation[],allocations:{lineIndex:number;amount:string}[]):InvoiceTaxAllocation{
 if(new Set(allocations.map(l=>l.lineIndex)).size!==allocations.length)throw new RangeError('Choose each billed line once.')
 for(const p of prior)if(p.orderId!==source.orderId||p.approvalId!==source.approvalId||p.currency!==agreement.currency||p.minorDigits!==agreement.minorDigits||p.policy!=='REMAINING_BALANCE_V1')throw new RangeError('Prior allocation belongs to another accepted tax agreement.')
 const lines=allocations.map(a=>{
  const frozen=agreement.lines.find(l=>l.key===String(a.lineIndex));if(!frozen)throw new RangeError('Billed line is not in the accepted agreement.')
  const previous=prior.flatMap(p=>p.lines.filter(l=>l.key===frozen.key)).reduce<TaxPortion|undefined>((sum,p)=>sum?addTaxPortions(sum,p):p,undefined)
  return allocateTaxPortion(frozen,previous,moneyMinor(a.amount,agreement.minorDigits))
 })
 const sum=(key:'netMinor'|'taxMinor'|'grossMinor')=>{const value=lines.reduce((s,l)=>s+BigInt(l[key]),BigInt(0));if(value>BigInt(Number.MAX_SAFE_INTEGER))throw new RangeError('Invoice tax allocation exceeds supported precision.');return Number(value)}
 return {format:1,policy:'REMAINING_BALANCE_V1',...source,currency:agreement.currency,minorDigits:agreement.minorDigits,netMinor:sum('netMinor'),taxMinor:sum('taxMinor'),grossMinor:sum('grossMinor'),lines}
}
