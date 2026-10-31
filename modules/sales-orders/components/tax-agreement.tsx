"use client"
import { useEffect,useState } from 'react'
import { Section } from '@/components/erp/section'
import { TaxAgreementSummary } from '@/platform/tax/source-pricing-controls'
import type { TaxAgreement } from '@/platform/tax/agreement'
export function OrderTaxAgreement({orderId}:{orderId:string}){
 const [data,setData]=useState<{snapshot:{agreement:TaxAgreement;basisReference:string}}|null>(),[error,setError]=useState('')
 useEffect(()=>{const c=new AbortController();fetch(`/api/sales-orders/${orderId}/tax-agreement`,{cache:'no-store',signal:c.signal}).then(async r=>{const d=await r.json();if(!r.ok)throw Error(d.error||'Unable to load accepted tax agreement.');return d}).then(d=>{if(!c.signal.aborted)setData(d.acceptance)}).catch(e=>{if(!c.signal.aborted)setError(e.message)});return()=>c.abort()},[orderId])
 if(error)return <p role="alert">{error}</p>
 if(!data)return null
 return <Section title="Accepted tax agreement"><TaxAgreementSummary agreement={data.snapshot.agreement}/><p className="mt-3 text-sm">Review basis: {data.snapshot.basisReference}</p><p className="mt-2 text-sm text-muted-foreground">Frozen when this order was created. Customer and tax-master edits cannot rewrite it. This is not a statutory tax invoice; invoices allocate these frozen balances. Statutory PDF issuance requires separate document controls.</p></Section>
}
