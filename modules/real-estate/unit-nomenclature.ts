import { z } from "zod"
import type { Prisma } from "@prisma/client"
import type { BusinessActor } from "@/platform/policy"
import type { CatalogPresentation } from "@/modules/catalog/contracts"
import { projectScope } from "./access"

const optionalText = (max: number) => z.string().trim().max(max).refine(value => !Array.from(value).some(c => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127), "Use a single-line number or code.").nullable().optional().transform(value => value || null)
export const unitNomenclatureShape = { unitNumber: optionalText(60), companyCode: optionalText(100), floor: optionalText(40) }

export async function propertyPresentation(tx: Prisma.TransactionClient, actor: BusinessActor, ids: string[]) {
  const rows = await tx.realEstateUnit.findMany({ where: { tenantId: actor.tenantId, itemId: { in: ids }, project: projectScope(actor, "read") }, select: { itemId: true, unitNumber: true, companyCode: true, category: { select: { name: true } }, item: { select: { name: true, code: true } }, project: { select: { name: true, lineage: { orderBy: { distance: "desc" }, select: { ancestor: { select: { name: true } } } } } } } })
  return new Map<string, CatalogPresentation>(rows.map(row => {
    const path = row.project.lineage.map(link => link.ancestor.name).join(" / ") || row.project.name
    const numberedName = `${row.category.name} ${row.unitNumber}`
    const displayName = row.unitNumber ? `${row.item.name === numberedName ? numberedName : `${row.item.name} (${numberedName})`} — ${path}` : row.item.name
    const displayCode = row.companyCode || (row.unitNumber ? null : row.item.code)
    return [row.itemId, { displayName, displayCode, selectionLabel: displayCode ? `${displayCode} · ${displayName}` : displayName, documentDescription: displayCode ? `${displayCode} · ${displayName}` : displayName }]
  }))
}
