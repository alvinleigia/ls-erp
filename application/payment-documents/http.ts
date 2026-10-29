import { prisma } from '@/lib/prisma'
import { withBusinessApi } from '@/platform/business-api'
import { BusinessError } from '@/platform/policy'
import { applicationPaymentDocuments } from './service'
export const withPaymentDocumentsApi=(request:Request,handler:(service:ReturnType<typeof applicationPaymentDocuments>)=>Promise<unknown>)=>withBusinessApi(request,actor=>{
 const url=new URL(request.url),host=request.headers.get('x-forwarded-host')||request.headers.get('host')||url.host,protocol=request.headers.get('x-forwarded-proto')||url.protocol.replace(':','')
 if(!['GET','HEAD'].includes(request.method)&&request.headers.get('origin')&&request.headers.get('origin')!==`${protocol}://${host}`)throw new BusinessError(403,'Cross-origin document changes are not permitted.')
 return handler(applicationPaymentDocuments(prisma,actor))
})
