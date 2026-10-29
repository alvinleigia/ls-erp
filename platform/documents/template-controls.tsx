"use client"
import { useCallback,useEffect,useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea,Select,Checkbox } from "@/components/erp/controls"
import { RecordSelect } from "@/components/erp/record-select"
import { FormField } from "@/components/form-field"
import { Section } from "@/components/erp/section"
import { pageClass } from "@/components/erp/page"
import { AccessPageHeader } from "@/platform/access/record-page"
import { ReloadDraft } from "@/components/erp/reload-draft"
import { useFormErrors } from "@/hooks/use-form-errors"
import { documentContentSchema,type DocumentContent } from "./validation"
import { DocumentLayoutEditor } from "./layout-editor"
import { validateDocumentLayout,type TemplateCatalog } from "./layout"
type Template={company:{id:string;name:string;archived:boolean};providerKey:string;version:number;content:DocumentContent;templateCatalog:TemplateCatalog}
type Catalog={items:{id:string;name:string}[];total:number;providers:{key:string;name:string}[];canPublish:boolean}
const textFields=[['title','Document title'],['opening','Opening paragraph'],['terms','Terms and notes'],['address','Issuing company address'],['contact','Office contact details'],['signatory','Signatory caption']] as const
export function DocumentTemplateControls(){
  const [catalog,setCatalog]=useState<Catalog>(),[companyId,setCompanyId]=useState(""),[providerKey,setProviderKey]=useState(""),[row,setRow]=useState<Template>(),[content,setContent]=useState<DocumentContent>(),[dirty,setDirty]=useState(false),[reviewed,setReviewed]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState("")
  const {errors,setErrors,clearErrors,setErrorsFromResponse}=useFormErrors<keyof DocumentContent>()
  useEffect(()=>{const c=new AbortController();fetch('/api/document-templates/catalog',{signal:c.signal,cache:'no-store'}).then(async r=>{const data=await r.json();if(!r.ok)throw Error(data.error);if(c.signal.aborted)return;setCatalog(data);if(data.total===1)setCompanyId(data.items[0].id);setProviderKey(data.providers[0]?.key??'')}).catch(e=>{if(!c.signal.aborted)setError(e.message)});return()=>c.abort()},[])
  const load=useCallback(async(signal?:AbortSignal)=>{
    if(!companyId||!providerKey)return
    const r=await fetch(`/api/document-templates?${new URLSearchParams({companyId,providerKey})}`,{signal,cache:'no-store'}),data=await r.json();if(!r.ok)throw Error(data.error)
    if(signal?.aborted)return
    setRow(data);setContent(documentContentSchema.parse(data.content));setDirty(false);setReviewed(false);setError('');clearErrors()
  },[companyId,providerKey,clearErrors])
  useEffect(()=>{const c=new AbortController();setRow(undefined);setContent(undefined);load(c.signal).catch(e=>{if(!c.signal.aborted)setError(e.message)});return()=>c.abort()},[load])
  function change<K extends keyof DocumentContent>(key:K,value:DocumentContent[K]){if(!content)return;setContent({...content,[key]:value});setDirty(true);setReviewed(false);setErrors(previous=>({...previous,[key]:''}))}
  async function publish(){
    if(!row||!content)return
    const parsed=documentContentSchema.safeParse(content)
    if(!parsed.success){setErrors(Object.fromEntries(parsed.error.issues.map(issue=>[issue.path[0],issue.message])) as Record<keyof DocumentContent,string>);setError('Please check the highlighted fields.');return}
    try{if(parsed.data.layout)validateDocumentLayout(parsed.data.layout,row.templateCatalog)}catch(e){setError((e as Error).message);return}
    setBusy(true);setError('');clearErrors()
    try{const r=await fetch('/api/document-templates',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({companyId,providerKey,version:row.version,content:parsed.data,reviewed})}),data=await r.json();if(!r.ok){setErrorsFromResponse(data);throw Error(data.error)}await load()}catch(e){setError((e as Error).message)}finally{setBusy(false)}
  }
  const readOnly=!catalog?.canPublish||!!row?.company.archived
  async function preview(){
    if(!row||!content)return
    setBusy(true);setError('')
    try{
      const r=await fetch('/api/document-templates/preview',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({companyId,providerKey,version:row.version,content})})
      if(!r.ok){const data=await r.json();setErrorsFromResponse(data);throw Error(data.error)}
      const url=URL.createObjectURL(await r.blob()),link=document.createElement('a');link.href=url;link.download='template-sample-preview.pdf';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000)
    }catch(e){setError((e as Error).message)}finally{setBusy(false)}
  }
  return <div className={pageClass}><AccessPageHeader title="Company document templates" description="Publish reviewed wording for the company that issues the order. Earlier versions and issued files remain fixed."/>
    <Section title="Issuing company and document"><div className="grid gap-4 md:grid-cols-2"><FormField id="document-company" label="Issuing company"><RecordSelect id="document-company" endpoint="/api/document-templates/catalog" value={companyId} selected={row?{value:row.company.id,label:row.company.name+(row.company.archived?' (archived)':'')}:undefined} onChange={value=>setCompanyId(value)} disabled={busy||dirty} /></FormField><FormField id="document-type" label="Document type"><Select id="document-type" value={providerKey} onValueChange={setProviderKey} disabled={busy||dirty}>{catalog?.providers.map(provider=><option key={provider.key} value={provider.key}>{provider.name}</option>)}</Select></FormField></div></Section>
    {error&&<p role="alert" className="text-destructive">{error}</p>}
    {row&&content&&<Section title={`${row.company.name} - version ${row.version}`} description={row.version?'Publishing creates the next version. Corrections to issued files use their replacement flow.':'No template has been published. These starter values do not enable issuance.'}>
      <fieldset disabled={busy||readOnly} className="grid gap-5 md:grid-cols-2">{textFields.map(([key,label])=><FormField key={key} id={`document-${key}`} label={label} error={errors[key]} className={['opening','terms'].includes(key)?'md:col-span-2':undefined}>{['opening','terms','address','contact'].includes(key)?<Textarea id={`document-${key}`} value={content[key]} rows={key==='terms'?8:3} onChange={e=>change(key,e.target.value)} />:<Input id={`document-${key}`} value={content[key]} onChange={e=>change(key,e.target.value)} />}</FormField>)}
        <label className="flex items-center gap-2"><Checkbox checked={content.useTenantLogo} onChange={e=>change('useTenantLogo',e.target.checked)}/>Use the tenant document logo for this company</label><label className="flex items-center gap-2"><Checkbox checked={content.enabled} onChange={e=>change('enabled',e.target.checked)}/>Enable new issuance with this version</label>
      </fieldset>
      {content.layout&&<div className="mt-6 space-y-3"><h3 className="font-medium">Document layout</h3><DocumentLayoutEditor key={`${companyId}:${providerKey}`} value={content.layout} catalog={row.templateCatalog} disabled={busy||readOnly} onChange={value=>change("layout",value)}/></div>}
      {!readOnly&&<div className="mt-6 space-y-4"><label className="flex items-start gap-2"><Checkbox checked={reviewed} disabled={busy} onChange={e=>setReviewed(e.target.checked)}/>I have reviewed the wording, company details and enablement for this version.</label><div className="flex flex-wrap gap-3"><Button variant="outline" disabled={busy} onClick={preview}>Download sample preview</Button><Button loading={busy} disabled={!reviewed} onClick={publish}>Publish template version</Button><ReloadDraft disabled={busy} onReload={()=>void load().catch(e=>setError(e.message))}/></div></div>}
      {readOnly&&<p className="mt-4 text-sm text-muted-foreground">Published wording is read-only here. A tenant administrator publishes new versions for active issuing companies.</p>}
    </Section>}
  </div>
}
