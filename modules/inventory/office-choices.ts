import { z } from "zod"
import { BusinessError, type BusinessActor } from "@/platform/policy"
import { inventoryRead } from "./office"
import type { RecordOffice } from "@/types/companies"

const schema = z.object({resource:z.enum(["inventoryProducts","inventoryPurchases"]),q:z.string().max(160).default(""),selected:z.string().max(160).optional(),page:z.coerce.number().int().min(1).max(10000).default(1),pageSize:z.coerce.number().int().min(1).max(100).default(20)})
export async function inventoryOfficeChoices(actor:BusinessActor,input:unknown) {
  const parsed=schema.safeParse(input)
  if (!parsed.success) throw new BusinessError(400,"Invalid office selection.")
  const q=parsed.data
  const view=await inventoryRead(actor,q.resource,async tx=>{
    const [r]=await tx.$queryRaw<{view:{items:RecordOffice[];selected:RecordOffice|null;total:number}}[]>`SELECT app.inventory_office_choices(${actor.tenantId},${q.resource},${q.selected??null},${q.q},${q.pageSize}::integer,${(q.page-1)*q.pageSize}::integer) view`
    return r.view
  })
  return {...view,page:q.page,pageSize:q.pageSize,totalPages:Math.max(1,Math.ceil(view.total/q.pageSize))}
}
