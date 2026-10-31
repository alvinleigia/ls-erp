"use client"
import { moneyText } from './agreement'
import type { InvoiceTaxAllocation } from './invoice-allocation'
export function InvoiceTaxSummary({value}:{value:InvoiceTaxAllocation}){
 const money=(n:number)=>moneyText(n,value.minorDigits)
 return <div className="space-y-3" role="region" aria-label="Frozen invoice tax allocation"><p>Net: {value.currency} {money(value.netMinor)} · Tax: {money(value.taxMinor)} · Gross: {money(value.grossMinor)}</p><div className="overflow-x-auto"><table className="w-full text-left text-sm"><caption className="sr-only">Allocated net and tax components by accepted line</caption><thead><tr><th className="p-2">Line</th><th className="p-2">Net</th><th className="p-2">Tax components</th><th className="p-2">Gross</th></tr></thead><tbody>{value.lines.map(l=><tr className="border-t" key={l.key}><td className="p-2">{Number(l.key)+1}</td><td className="p-2">{money(l.netMinor)}</td><td className="p-2">{l.components.map(c=>`${c.code}: ${money(c.amountMinor)}`).join('; ')||'No charged components'}</td><td className="p-2">{money(l.grossMinor)}</td></tr>)}</tbody></table></div><p className="text-sm text-muted-foreground">Allocated from the accepted agreement and actual remaining component balances. Current tax-master values are not used.</p></div>
}
