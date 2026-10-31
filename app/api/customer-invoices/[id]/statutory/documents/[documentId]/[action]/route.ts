import { NextResponse } from 'next/server'
import { withStatutoryInvoicesApi } from '@/application/customer-invoices/http'
import { readJson } from '@/platform/business-api'
import { BusinessError } from '@/platform/policy'
import { z } from 'zod'
type Context={params:Promise<{id:string;documentId:string;action:string}>}
export const POST=(r:Request,c:Context)=>withStatutoryInvoicesApi(r,async s=>{
 const {id,documentId,action}=await c.params,key=z.enum(['print','complete','void']).parse(action)
 if(key==='print')return s.print(id,documentId)
 if(key==='void')return s.void(id,documentId,await readJson(r))
 if(Number(r.headers.get('content-length')||0)>3*1024*1024+32768)throw new BusinessError(413,'Upload a signed PDF up to 3 MB.')
 const form=await r.formData(),file=form.get('file'),metadata=form.get('metadata')
 if(!(file instanceof File)||typeof metadata!=='string'||metadata.length>8000)throw new BusinessError(400,'Choose the signed PDF and confirm its signing details.')
 let body:unknown;try{body=JSON.parse(metadata)}catch{throw new BusinessError(400,'Invalid signing details.')}
 if(file.size>3*1024*1024)throw new BusinessError(413,'Upload a signed PDF up to 3 MB.')
 return s.complete(id,documentId,body,new Uint8Array(await file.arrayBuffer()))
})
export const GET=(r:Request,c:Context)=>withStatutoryInvoicesApi(r,async s=>{
 const {id,documentId,action}=await c.params;z.literal('pdf').parse(action)
 const q=z.object({copy:z.enum(['print','signed']),acknowledgeHistorical:z.enum(['true','false']).default('false')}).strict().parse(Object.fromEntries(new URL(r.url).searchParams))
 return NextResponse.redirect(await s.download(id,documentId,q.copy,q.acknowledgeHistorical==='true'))
})
