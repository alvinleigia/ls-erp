import type { Prisma } from "@prisma/client"

type SavedProductLine = Prisma.AppointmentOrderProductLineGetPayload<{include:{product:{select:{id:true;sku:true;name:true}}}}>
// Saved financial lines remain readable under booking permissions even when
// catalogue access/activation is removed. No current stock or catalogue prices
// enter this source-bound projection.
export async function savedBookingProducts<T extends {id:string}>(db:Prisma.TransactionClient,tenantId:string,orders:T[]) {
  if(!orders.length)return orders.map(o=>({...o,productLines:[] as SavedProductLine[]}))
  const rows=await db.$queryRaw<{orderId:string;line:Omit<SavedProductLine,"createdAt"|"updatedAt"> & {createdAt:string;updatedAt:string}}[]>`SELECT * FROM app.booking_saved_product_lines(${tenantId},${orders.map(o=>o.id)}::text[])`
  const grouped=new Map<string,SavedProductLine[]>()
  for(const {orderId,line} of rows){
    const date=(s:string)=>new Date(s.endsWith("Z")?s:s+"Z")
    const entry={...line,createdAt:date(line.createdAt),updatedAt:date(line.updatedAt)}
    grouped.set(orderId,[...(grouped.get(orderId)??[]),entry])
  }
  return orders.map(o=>({...o,productLines:grouped.get(o.id)??[]}))
}
