import { z } from "zod"
import { NextResponse } from "next/server"
import { withBusinessApi } from "@/platform/business-api"
import { BusinessError } from "@/platform/policy"
import { inventoryRead } from "@/modules/inventory/office"
import type { RecordOffice } from "@/types/companies"

const schema = z.object({resource:z.enum(["inventoryProducts","inventoryPurchases"]),q:z.string().max(160).default(""),selected:z.string().max(160).optional(),page:z.coerce.number().int().min(1).max(10000).default(1),pageSize:z.coerce.number().int().min(1).max(100).default(20)})
export function GET(request:Request) {
  return withBusinessApi(request,async actor=>{
    const parsed=schema.safeParse(Object.fromEntries(new URL(request.url).searchParams))
    if (!parsed.success) throw new BusinessError(400,"Invalid office selection.")
    const q=parsed.data
    const view=await inventoryRead(actor,q.resource,async tx=>{
      const [r]=await tx.$queryRaw<{view:{items:RecordOffice[];selected:RecordOffice|null;total:number}}[]>`SELECT app.inventory_office_choices(${actor.tenantId},${q.resource},${q.selected??null},${q.q},${q.pageSize}::integer,${(q.page-1)*q.pageSize}::integer) view`
      return r.view
    })
    return NextResponse.json({...view,page:q.page,pageSize:q.pageSize,totalPages:Math.max(1,Math.ceil(view.total/q.pageSize))})
  })
}
