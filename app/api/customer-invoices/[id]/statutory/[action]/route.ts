import { NextResponse } from 'next/server'
import { withStatutoryInvoicesApi } from '@/application/customer-invoices/http'
import { readJson } from '@/platform/business-api'
import { z } from 'zod'
export const POST=(r:Request,c:{params:Promise<{id:string;action:string}>})=>withStatutoryInvoicesApi(r,async s=>{
 const {id,action}=await c.params,key=z.enum(['series','review','prepare','preview','reserve']).parse(action),body=await readJson(r)
 if(key==='preview'){const pdf=await s.preview(id,body);return new NextResponse(new Uint8Array(pdf).buffer,{headers:{'Content-Type':'application/pdf','Content-Disposition':'attachment; filename="statutory-preview.pdf"'}})}
 return s[key](id,body)
})
export const GET=(r:Request,c:{params:Promise<{id:string;action:string}>})=>withStatutoryInvoicesApi(r,async s=>{const {id,action}=await c.params;z.literal('series').parse(action);return s.seriesChoices(id,Object.fromEntries(new URL(r.url).searchParams))})
