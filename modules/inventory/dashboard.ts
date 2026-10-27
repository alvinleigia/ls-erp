import type { Prisma } from "@prisma/client"
import { moduleEnabled, type ModuleFlag } from "@/platform/modules"
import { permits } from "@/platform/access/policy"
import type { RecordOffice } from "@/types/companies"
import type { BusinessActor } from "@/platform/policy"
import { Prisma as Sql } from "@prisma/client"

export async function inventoryDashboardData(tx: Prisma.TransactionClient, actor: BusinessActor, flags: ModuleFlag[]) {
  const { tenantId } = actor
  const canReadStock = moduleEnabled(flags, "inventory") && permits(actor, "inventoryProducts.read")
  const [context] = canReadStock ? await tx.$queryRaw<{ officeId: string | null; office: RecordOffice | null }[]>`SELECT p."creationOfficeId" AS "officeId",app.inventory_office_label(${tenantId},p."creationOfficeId") office FROM "BusinessOfficePolicy" p WHERE p."tenantId"=${tenantId} AND p."userId"=${actor.userId} AND app.inventory_office_read(${tenantId},p."creationOfficeId")` : []
  const lowStockProducts = context?.officeId ? await tx.$queryRaw<{ id: string; sku: string; name: string; onHandQty: number; reorderPoint: number; reorderQty: number; category: { name: string } }[]>(Sql.sql`
    SELECT p.id,p.sku,p.name,COALESCE(s."onHandQty",0)::integer "onHandQty",COALESCE(s."reorderPoint",0)::integer "reorderPoint",COALESCE(s."reorderQty",0)::integer "reorderQty",jsonb_build_object('name',c.name) category
    FROM "InventoryProduct" p JOIN "InventoryCategory" c ON c.id=p."categoryId" LEFT JOIN "InventoryOfficeStock" s ON s."tenantId"=p."tenantId" AND s."productId"=p.id AND s."officeId"=${context.officeId}
    WHERE p."tenantId"=${tenantId} AND p.status='ACTIVE' AND COALESCE(s."onHandQty",0)<=COALESCE(s."reorderPoint",0) ORDER BY COALESCE(s."onHandQty",0),p.id LIMIT 8`) : []
  return { visible: canReadStock && !!context?.officeId, lowStockProducts, office: context?.office ?? null }
}
