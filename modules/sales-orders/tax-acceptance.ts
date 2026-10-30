import type { PrismaClient } from '@prisma/client'
import { authorizeBusinessOperation } from '@/platform/access/operation'
import { salesOrderRecordScope } from '@/platform/access/record-scope'
import { BusinessError,type BusinessActor } from '@/platform/policy'
export function readOrderTaxAcceptance(db:PrismaClient,identity:Pick<BusinessActor,'tenantId'|'userId'|'requestId'>,id:string){
 return db.$transaction(async tx=>{
  const a=await authorizeBusinessOperation(tx,identity,'salesOrders.read',['salesOrders'])
  if(!await tx.salesOrder.findFirst({where:{AND:[salesOrderRecordScope(a),{id}]},select:{id:true}}))throw new BusinessError(404,'Sales order not found.')
  return {acceptance:await tx.salesOrderTaxAcceptance.findUnique({where:{tenantId_orderId:{tenantId:a.tenantId,orderId:id}}})}
 },{isolationLevel:'Serializable',maxWait:20000,timeout:20000})
}
