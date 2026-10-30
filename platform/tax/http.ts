import { prisma } from '@/lib/prisma'
import { withBusinessApi } from '@/platform/business-api'
import { BusinessError } from '@/platform/policy'
import { createTaxConfigurationService } from './service'
export const taxQuery=(r:Request)=>Object.fromEntries(new URL(r.url).searchParams)
export const withTaxConfigurationApi=(r:Request,fn:(s:ReturnType<typeof createTaxConfigurationService>)=>Promise<unknown>,status=200)=>withBusinessApi(r,a=>{
 if(!['GET','HEAD'].includes(r.method)){const u=new URL(r.url),host=r.headers.get('x-forwarded-host')||r.headers.get('host')||u.host,protocol=r.headers.get('x-forwarded-proto')||u.protocol.slice(0,-1);if(r.headers.get('origin')&&r.headers.get('origin')!==`${protocol}://${host}`)throw new BusinessError(403,'Cross-origin tax configuration changes are not permitted.')}
 return fn(createTaxConfigurationService(prisma,a))
},status)
