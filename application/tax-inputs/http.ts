import { prisma } from '@/lib/prisma'
import { withBusinessApi } from '@/platform/business-api'
import { createQuotationTaxInputService } from '@/modules/sales-documents/tax-input-service'
import { BusinessError } from '@/platform/policy'
export const withQuotationTaxInputs=(r:Request,fn:(s:ReturnType<typeof createQuotationTaxInputService>)=>Promise<unknown>)=>withBusinessApi(r,a=>{
 if(!['GET','HEAD'].includes(r.method)){const u=new URL(r.url),host=r.headers.get('x-forwarded-host')||r.headers.get('host')||u.host,protocol=r.headers.get('x-forwarded-proto')||u.protocol.slice(0,-1);if(r.headers.get('origin')&&r.headers.get('origin')!==`${protocol}://${host}`)throw new BusinessError(403,'Cross-origin tax preparation is not permitted.')}
 return fn(createQuotationTaxInputService(prisma,a))
})
