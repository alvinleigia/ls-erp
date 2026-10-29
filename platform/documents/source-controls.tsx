"use client"
import { useCallback,useEffect,useState } from "react"
import { Section } from "@/components/erp/section"
import { Button } from "@/components/ui/button"
import { Select,Textarea } from "@/components/erp/controls"
import { FormField } from "@/components/form-field"
import { Pagination } from "@/components/erp/pagination"
import { ConfirmAction } from "@/components/erp/confirm-action"
import { useDateFormatter } from "@/hooks/use-date-formatter"
import { sourceDocumentRequest } from "./source-request"
type Row={id:string;providerKey:string;version:number;reference:string;templateVersion:number;supersedesId:string|null;reason:string;createdAt:string;isLatest:boolean}
type Result={items:Row[];latest:Pick<Row,'id'|'providerKey'|'version'|'reference'>[];total:number;page:number;pageSize:number;providers:{key:string;name:string}[];canIssue:boolean;notice?:string;historical?:boolean;recordAccess:{permissions:Record<string,boolean>}}
type Prepared={providerKey:string;templateVersion:number;version:number;supersedesId:string|null;previewHash:string;title:string;reference:string;date:string}
export function SourceDocuments({endpoint,permissionResource,title="Issued documents",description="Preview a new document, then issue its exact PDF. Replacements retain the original file and its history."}:{endpoint:string;permissionResource:"orderDocuments"|"paymentDocuments";title?:string;description?:string}){
  const [data,setData]=useState<Result>(),[page,setPage]=useState(1),[providerKey,setProviderKey]=useState(''),[reason,setReason]=useState(''),[prepared,setPrepared]=useState<Prepared>(),[requestKey,setRequestKey]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false),[confirm,setConfirm]=useState(false)
  const {formatDateTime}=useDateFormatter()
  const load=useCallback(async(signal?:AbortSignal)=>{const value=await sourceDocumentRequest<Result>(`${endpoint}?page=${page}`,{signal});if(signal?.aborted)return;setData(value);setProviderKey(current=>value.providers.some(row=>row.key===current)?current:value.providers[0]?.key??'')},[endpoint,page])
  useEffect(()=>{const c=new AbortController();load(c.signal).catch(e=>{if(!c.signal.aborted){setData(undefined);setError(e.message)}});return()=>c.abort()},[load])
  const latest=data?.latest.find(row=>row.providerKey===providerKey)
  const input=()=>({providerKey,supersedesId:prepared?prepared.supersedesId:latest?.id??null,reason})
  async function prepare(){setBusy(true);setError('');try{const value=await sourceDocumentRequest<Prepared>(`${endpoint}/prepare`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({providerKey,supersedesId:latest?.id??null,reason})});setPrepared(value);setRequestKey(crypto.randomUUID())}catch(e){setError((e as Error).message)}finally{setBusy(false)}}
  async function preview(){if(!prepared)return;setBusy(true);setError('');try{const response=await fetch(`${endpoint}/preview`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...input(),previewHash:prepared.previewHash})});if(!response.ok){const data=await response.json();throw Error(data.error)}const url=URL.createObjectURL(await response.blob()),link=document.createElement('a');link.href=url;link.download='document-preview.pdf';link.click();setTimeout(()=>URL.revokeObjectURL(url),30000)}catch(e){setError((e as Error).message)}finally{setBusy(false)}}
  async function issue(){if(!prepared)return;setBusy(true);setError('');try{await sourceDocumentRequest(`${endpoint}/issue`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...input(),previewHash:prepared.previewHash,requestKey})});setPrepared(undefined);setReason('');setConfirm(false);await load()}catch(e){setError((e as Error).message);setConfirm(false)}finally{setBusy(false)}}
  return <Section title={title} description={description}><div className="space-y-4">
    <Button variant="outline" disabled={busy} onClick={()=>{setError('');void load().catch(e=>{setData(undefined);setError(e.message)})}}>Refresh documents</Button>
    {data?.canIssue&&<div className="space-y-4 rounded-md border p-4"><FormField id="order-document-kind" label="Document type"><Select id="order-document-kind" value={providerKey} disabled={busy} onValueChange={key=>{setProviderKey(key);setPrepared(undefined);setReason('');setError('')}}>{data.providers.map(row=><option key={row.key} value={row.key}>{row.name}</option>)}</Select></FormField>
      {latest&&<><p>Current issued version: {latest.reference}. Preparing another version replaces this document.</p><FormField id="document-replacement-reason" label="Replacement reason"><Textarea id="document-replacement-reason" maxLength={2000} value={reason} disabled={busy} onChange={e=>{setReason(e.target.value);setPrepared(undefined)}}/></FormField></>}
      <Button variant="outline" loading={busy&&!prepared} disabled={busy||!providerKey||!!latest&&!reason.trim()} onClick={prepare}>{prepared?'Refresh prepared preview':'Prepare document'}</Button>
      {prepared&&<div className="space-y-3"><p className="font-medium">{prepared.title} - {prepared.reference}</p><p className="text-sm text-muted-foreground">Template version {prepared.templateVersion}. Letter date: {prepared.date}. Source facts and current access are checked again before issuance.</p><div className="flex flex-wrap gap-3"><Button variant="outline" disabled={busy} onClick={preview}>Download draft preview</Button><Button loading={busy} onClick={()=>setConfirm(true)}>Issue document</Button></div></div>}
    </div>}
    {data?.notice&&<p role="status" className="rounded-md border p-3 text-sm">{data.notice}</p>}
    {error&&<p role="alert" className="text-destructive">{error}</p>}
    {data&&!data.items.length&&<p>No accessible issued documents.</p>}
    {data?.items.map(row=><article key={row.id} className="space-y-2 rounded-md border p-4"><div className="flex flex-wrap items-center justify-between gap-3"><p className="break-words font-medium">{row.reference}{row.isLatest?'':' - replaced version'}</p>{data.recordAccess.permissions[`${permissionResource}.export`]&&<Button asChild variant="outline"><a target="_blank" rel="noreferrer" href={`${endpoint}/${row.id}/pdf?${new URLSearchParams({providerKey:row.providerKey,...(data.historical?{acknowledgeReversal:"true"}:{})})}`}>{data.historical?"Download historical original PDF":"Download issued PDF"}</a></Button>}</div><p className="text-sm text-muted-foreground">{data.providers.find(provider=>provider.key===row.providerKey)?.name??row.providerKey} - template {row.templateVersion} - {formatDateTime(row.createdAt)}</p>{row.reason&&<p className="whitespace-pre-wrap break-words">Replacement reason: {row.reason}</p>}</article>)}
    {data&&<Pagination {...data} onPageChange={setPage} label="Issued documents pagination"/>}
    {confirm&&<ConfirmAction title={`Issue ${prepared?.reference}?`} description="This archives the reviewed PDF. Later downloads reuse those exact bytes. A correction creates a linked replacement." label="Confirm issuance" busy={busy} onCancel={()=>setConfirm(false)} onConfirm={()=>void issue()}/>}
  </div></Section>
}
