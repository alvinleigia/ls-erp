import { z } from "zod"
import { NextResponse } from "next/server"
import { withInventoryApi } from "@/modules/inventory/api"
import { inventoryRead } from "@/modules/inventory/office"
import { BusinessError } from "@/platform/policy"

const schema=z.object({page:z.coerce.number().int().min(1).default(1),pageSize:z.coerce.number().int().min(1).max(100).default(20),q:z.string().trim().max(160).default(""),status:z.enum(["ACTIVE","INACTIVE"]).optional()})
// Shared catalogue choices contain no office quantities, costs or reorder data.
export function GET(request:Request) {
  return withInventoryApi(request,"inventoryProducts","read",async actor=>{
    const parsed=schema.safeParse(Object.fromEntries(new URL(request.url).searchParams))
    if(!parsed.success)throw new BusinessError(400,"Invalid product choices.")
    const q=parsed.data
    return NextResponse.json(await inventoryRead(actor,"inventoryProducts",async tx=>{
      const where={tenantId:actor.tenantId,...(q.status?{status:q.status}:{}),...(q.q?{OR:[{name:{contains:q.q,mode:"insensitive" as const}},{sku:{contains:q.q,mode:"insensitive" as const}}]}:{})}
      const total=await tx.inventoryProduct.count({where})
      const items=await tx.inventoryProduct.findMany({where,orderBy:[{name:"asc"},{id:"asc"}],skip:(q.page-1)*q.pageSize,take:q.pageSize,select:{id:true,sku:true,name:true,mrpCents:true,category:{select:{id:true}},taxes:{select:{taxId:true}}}})
      return {items:items.map(({taxes,...p})=>({...p,taxIds:taxes.map(t=>t.taxId)})),page:q.page,pageSize:q.pageSize,total,totalPages:Math.max(1,Math.ceil(total/q.pageSize))}
    }))
  })
}
