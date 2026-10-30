import { createPartyTaxService } from '@/platform/tax/party/service'
import { contactScope,accountScope } from './policy'
import type { CrmServiceContext } from './service-context'
import type { PermissionRun } from '@/platform/access/server'

// The owning module installs only its canonical access probe.
export function createCrmPartyTaxService(context:CrmServiceContext&{runLocked:PermissionRun}){
 return createPartyTaxService({...context,owner:async(tx,a,o,action,lock)=>{
  if(o.kind==='PERSON'){
   if(lock)await tx.$queryRaw`SELECT id FROM "CrmContact" WHERE "tenantId"=${a.tenantId} AND id=${o.id} FOR UPDATE`
   return tx.crmContact.findFirst({where:{...contactScope(a,action),id:o.id},select:{id:true,archived:true}})
  }
  if(lock)await tx.$queryRaw`SELECT id FROM "CrmAccount" WHERE "tenantId"=${a.tenantId} AND id=${o.id} FOR UPDATE`
  return tx.crmAccount.findFirst({where:{...accountScope(a,action),id:o.id},select:{id:true,archived:true}})
 }})
}
