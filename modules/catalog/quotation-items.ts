import type { QuotationDependencies, QuotationItemReference } from "@/modules/sales-documents/quotation-contracts"
import { BusinessError } from "@/platform/policy"
import { requirePermission } from "@/platform/access/policy"
import { catalogScope } from "./service"
import type { CatalogExtension } from "./contracts"
import { activeReservation, reservationClock } from "./reservation-availability"

// References are generated on the server and stored in each immutable revision.
// Retained references remain usable when an optional module is switched off.
export function catalogQuotationItems(extensions: readonly CatalogExtension[]): NonNullable<QuotationDependencies["resolveItems"]> {
  return async (tx, actor, content, previous) => {
    const linked = content.lines.filter(line => line.catalogItemId)
    const retained=(line:typeof linked[number])=>previous.some(item=>item.itemId===line.catalogItemId&&item.version===line.catalogItemVersion)
    const missing = linked.filter(line => !retained(line)||line.refreshCatalogItem)
    let fresh: QuotationItemReference[] = []
    if (missing.length) {
      requirePermission(actor, "catalogItems.read")
      if (!await tx.tenantModule.count({ where: { tenantId: actor.tenantId, key: "catalog", allowed: true, enabled: true } })) throw new BusinessError(403, "Enable Sales Catalog before selecting items.")
      const scope=await catalogScope(tx,actor,extensions),now=await reservationClock(tx)
      const [newRows,retainedRows]=await Promise.all([
        tx.catalogItem.findMany({where:{AND:[scope,{id:{in:missing.filter(line=>!retained(line)).map(line=>line.catalogItemId!)},archived:false,availability:"AVAILABLE",reservations:{none:activeReservation(now)}}]}}),
        tx.catalogItem.findMany({where:{AND:[scope,{id:{in:missing.filter(retained).map(line=>line.catalogItemId!)},archived:false}]}}),
      ])
      const rows=[...newRows,...retainedRows]
      fresh = await Promise.all(missing.map(async line => {
        const row = rows.find(row => row.id === line.catalogItemId && row.version === line.catalogItemVersion)
        if (!row) throw new BusinessError(409, "A selected item changed or is no longer available. Select it again or remove its link.")
        const extension=extensions.find(extension=>extension.key===row.extensionKey)
        const documentEvidence=extension?.documentEvidence?{key:extension.key,value:await extension.documentEvidence(tx,actor,row.id)}:undefined
        return { itemId: row.id, version: row.version, code: row.code, name: row.name, kind: row.kind, currency: row.currency, ...(documentEvidence?{documentEvidence}:{}) }
      }))
    }
    const units = new Set<string>(), result: QuotationItemReference[] = []
    for (const line of linked) {
      const item = [...fresh, ...previous].find(item => item.itemId === line.catalogItemId && item.version === line.catalogItemVersion)!
      if (item.currency !== content.currency) throw new BusinessError(400, "Catalog items must use the quotation currency. No currency conversion is applied.")
      if (item.kind === "UNIT") {
        if (Number(line.quantity) !== 1 || units.has(item.itemId)) throw new BusinessError(400, "A unique unit can appear only once, with quantity 1.")
        units.add(item.itemId)
      }
      if (!result.some(ref => ref.itemId === item.itemId && ref.version === item.version)) result.push(item)
    }
    return result
  }
}
