import { Prisma } from "@prisma/client"
import { BusinessError, type BusinessActor } from "@/platform/policy"
import { requirePermission } from "@/platform/access/policy"
import { salesOrderRecordScope } from "@/platform/access/record-scope"
export async function readReceivableBalances(tx:Prisma.TransactionClient,tenantId:string,orderId:string) {
  const lines=await tx.orderReceivableLine.findMany({where:{tenantId,orderId},orderBy:{position:"asc"}})
  const paid=await tx.orderReceiptAllocation.groupBy({by:["lineId"],where:{tenantId,orderId,payment:{status:"POSTED"}},_sum:{amount:true}})
  return lines.map(line=>{const received=paid.find(row=>row.lineId===line.id)?._sum.amount||new Prisma.Decimal(0);return {...line,paid:received,outstanding:line.amount.minus(received)}})
}
export async function readReceivableDocumentEvidence(tx:Prisma.TransactionClient,actor:BusinessActor,id:string) {
  requirePermission(actor,["receivables.read","orderPayments.read"])
  for(const resource of ["receivables","orderPayments"] as const){if(!await tx.salesOrder.findFirst({where:{AND:[salesOrderRecordScope({...actor,operation:{resource,action:"read"}},resource),{id}]},select:{id:true}}))throw new BusinessError(404,"The financial source is not available.")}
  const account=await tx.orderReceivable.findUnique({where:{tenantId_orderId:{tenantId:actor.tenantId,orderId:id}}})
  if(!account)return {state:"UNOPENED" as const,version:null,total:null,paid:null,outstanding:null,lines:[]}
  const lines=await readReceivableBalances(tx,actor.tenantId,id),paid=lines.reduce((value,row)=>value.plus(row.paid),new Prisma.Decimal(0))
  return {state:"OPENED" as const,version:account.version,total:account.total.toString(),paid:paid.toString(),outstanding:account.total.minus(paid).toString(),lines:lines.map(row=>({label:row.label,amount:row.amount.toString(),paid:row.paid.toString(),outstanding:row.outstanding.toString(),dueOn:row.dueOn?.toISOString().slice(0,10)??null}))}
}
export type ReceivableDocumentEvidence=Awaited<ReturnType<typeof readReceivableDocumentEvidence>>
