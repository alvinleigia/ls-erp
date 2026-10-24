import type { PrismaClient } from "@prisma/client"
import { BusinessError, type BusinessActor } from "@/platform/policy"
import { ownedRecordScope } from "@/platform/access/record-scope"
import { createReservationService } from "@/modules/catalog/reservations"
import type { QuotationSnapshot } from "@/modules/sales-documents/quotation-service"
import { catalogExtensions } from "./service"
export const applicationReservations = (db: PrismaClient, actor: Pick<BusinessActor, "tenantId" | "userId" | "requestId">) => createReservationService(db, actor, {
  async find(tx, identity, id) {
    const order = await tx.salesOrder.findFirst({ where: { tenantId: identity.tenantId, id, source: { quotation: { opportunity: { AND: [ownedRecordScope(identity, "unitReservations"), ownedRecordScope(identity, "salesOrders", "read")] } } } } })
    if (!order) throw new BusinessError(404, "Sales order not found.")
    return order
  },
  units: order => ((order.snapshot as unknown as QuotationSnapshot).items || []).filter(ref => ref.kind === "UNIT"),
}, catalogExtensions)
