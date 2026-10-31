import { prisma } from '@/lib/prisma'
import { withBusinessApi } from '@/platform/business-api'
import { BusinessError } from '@/platform/policy'
import { applicationCustomerInvoices,applicationInvoiceDocuments,applicationStatutoryInvoices } from './service'
function origin(request:Request){if(['GET','HEAD'].includes(request.method))return;const url=new URL(request.url),host=request.headers.get('x-forwarded-host')||request.headers.get('host')||url.host,protocol=request.headers.get('x-forwarded-proto')||url.protocol.replace(':','');if(request.headers.get('origin')&&request.headers.get('origin')!==`${protocol}://${host}`)throw new BusinessError(403,'Cross-origin invoice changes are not permitted.')}
export const withCustomerInvoicesApi=(request:Request,handler:(service:ReturnType<typeof applicationCustomerInvoices>)=>Promise<unknown>)=>withBusinessApi(request,actor=>{origin(request);return handler(applicationCustomerInvoices(prisma,actor))})
export const withInvoiceDocumentsApi=(request:Request,handler:(service:ReturnType<typeof applicationInvoiceDocuments>)=>Promise<unknown>)=>withBusinessApi(request,actor=>{origin(request);return handler(applicationInvoiceDocuments(prisma,actor))})
export const withStatutoryInvoicesApi=(request:Request,handler:(service:ReturnType<typeof applicationStatutoryInvoices>)=>Promise<unknown>)=>withBusinessApi(request,actor=>{origin(request);return handler(applicationStatutoryInvoices(prisma,actor))})
