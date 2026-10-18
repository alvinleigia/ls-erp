import type { QuotationDependencies, QuotationItemReference } from "@/modules/sales-documents/quotation-contracts"
import { BusinessError } from "@/platform/policy"
import { requirePermission } from "@/platform/access/policy"
import { catalogScope } from "./service"
import type { CatalogExtension } from "./contracts"

// References are generated on the server and stored in each immutable revision.
// Retained references remain usable when an optional module is switched off.
export function catalogQuotationItems(extensions: readonly CatalogExtension[]): NonNullable<QuotationDependencies["resolveItems"]> {
  return async (tx, actor, content, previous) => {
    const linked = content.lines.filter(line => line.catalogItemId)
    const missing = linked.filter(line => !previous.some(item => item.itemId === line.catalogItemId && item.version === line.catalogItemVersion))
    let fresh: QuotationItemReference[] = []
    if (missing.length) {
      requirePermission(actor, "catalogItems.read")
      if (!await tx.tenantModule.count({ where: { tenantId: actor.tenantId, key: "catalog", allowed: true, enabled: true } })) throw new BusinessError(403, "Enable Sales Catalog before selecting items.")
      const rows = await tx.catalogItem.findMany({ where: { AND: [await catalogScope(tx, actor, extensions), { id: { in: missing.map(line => line.catalogItemId!) }, archived: false, availability: "AVAILABLE" }] } })
      fresh = missing.map(line => {
        const row = rows.find(row => row.id === line.catalogItemId && row.version === line.catalogItemVersion)
        if (!row) throw new BusinessError(409, "A selected item changed or is no longer available. Select it again or remove its link.")
        return { itemId: row.id, version: row.version, code: row.code, name: row.name, kind: row.kind, currency: row.currency }
      })
    }
    const units = new Set<string>(), result: QuotationItemReference[] = []
    for (const line of linked) {
      const item = [...previous, ...fresh].find(item => item.itemId === line.catalogItemId && item.version === line.catalogItemVersion)!
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
