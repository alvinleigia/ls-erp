import { z } from "zod"
import type { Prisma } from "@prisma/client"
import { BusinessError, type BusinessActor } from "@/platform/policy"
import { projectScope } from "./service"
const id=z.string().min(1).max(100),text=z.string().max(2000)
const project=z.object({id,name:text,code:text,location:text,version:z.number().int().positive()}).strict()
export const propertyDocumentEvidenceSchema=z.object({format:z.literal(1),tenantId:id,itemId:id,project:project.extend({parent:project.nullable()}).strict(),category:text,area:z.string().nullable(),areaUnit:z.enum(["SQ_FT","SQ_M"])}).strict()
export async function readPropertyDocumentEvidence(tx:Prisma.TransactionClient,actor:BusinessActor,itemId:string) {
  const [row]=await readPropertyDocumentEvidenceSet(tx,actor,[itemId])
  if(!row)throw new BusinessError(404,"Property document source not found.")
  return row
}
export async function readPropertyDocumentEvidenceSet(tx:Prisma.TransactionClient,actor:BusinessActor,itemIds:string[]) {
  const rows=await tx.realEstateUnit.findMany({where:{tenantId:actor.tenantId,itemId:{in:itemIds},project:projectScope(actor,"read")},include:{category:{select:{name:true}},project:{select:{id:true,name:true,code:true,location:true,version:true,parent:{select:{id:true,name:true,code:true,location:true,version:true}}}}},orderBy:{itemId:"asc"}})
  return rows.map(row=>propertyDocumentEvidenceSchema.parse({format:1,tenantId:actor.tenantId,itemId:row.itemId,project:row.project,category:row.category.name,area:row.area?.toString()??null,areaUnit:row.areaUnit}))
}
