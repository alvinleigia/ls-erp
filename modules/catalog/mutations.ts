import { Prisma } from "@prisma/client"
import { requireWriteFields } from "@/platform/access/policy"
import { BusinessError, type BusinessActor } from "@/platform/policy"
import { recordDomainAuditEvent } from "@/lib/domain-audit"
import { catalogItemSchema } from "./validation"
import type { CatalogExtension } from "./contracts"
import { reservedUnits, reservationClock } from "./reservation-availability"
import { catalogScope } from "./scope"
const json = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value))
export async function findCatalogItem(tx: Prisma.TransactionClient, actor: BusinessActor, extensions: readonly CatalogExtension[], id: string) {
  const row = await tx.catalogItem.findFirst({ where: { AND: [await catalogScope(tx, actor, extensions), { id }] } })
  if (!row) throw new BusinessError(404, "Catalog item not found.")
  return row
}
// Interactive saves and imports share the same authority, addon validation and audit.
export async function saveCatalogItem(tx: Prisma.TransactionClient, actor: BusinessActor, extensions: readonly CatalogExtension[], input: unknown, id?: string, validateOnly = false) {
  const data = catalogItemSchema.parse(input)
  if (id) {
    await findCatalogItem(tx, actor, extensions, id)
    await tx.$queryRaw`SELECT id FROM "CatalogItem" WHERE "tenantId"=${actor.tenantId} AND id=${id} FOR UPDATE`
    if ((await reservedUnits(tx, actor.tenantId, [id], await reservationClock(tx))).has(id)) throw new BusinessError(409, "Release the unit reservation before changing this catalog item.")
  }
  const before = id ? await findCatalogItem(tx, actor, extensions, id) : null
  requireWriteFields(actor, "catalogItems", before ?? undefined, data)
  if (before && (data.version !== before.version || data.kind !== before.kind || data.extensionKey !== before.extensionKey)) throw new BusinessError(409, "Refresh this item. Its kind and extension cannot be changed after creation.")
  const extension = data.extensionKey ? extensions.find(e => e.key === data.extensionKey) : undefined
  if (data.extensionKey && !extension) throw new BusinessError(400, "Unknown catalog extension.")
  if (extension && !(await extension.scope(tx, actor))) throw new BusinessError(403, "This item extension is not available to your account.")
  if (extension && data.kind !== "UNIT") throw new BusinessError(400, "Property details require an individually identified unit.")
  if (validateOnly) {
    if (extension) {
      if (!extension.validateCreate) throw new BusinessError(400, "This extension does not support imports.")
      await extension.validateCreate(tx, actor, data.extension)
    }
    return null
  }
  const { version: _version, extension: _extension, ...fields } = data
  void _version; void _extension
  const values = { ...fields, price: new Prisma.Decimal(data.price) }
  if (id) {
    const changed = await tx.catalogItem.updateMany({ where: { tenantId: actor.tenantId, id, version: data.version }, data: { ...values, version: { increment: 1 } } })
    if (!changed.count) throw new BusinessError(409, "This item changed. Refresh before saving.")
  }
  const row = id ? await tx.catalogItem.findUniqueOrThrow({ where: { tenantId_id: { tenantId: actor.tenantId, id } } }) : await tx.catalogItem.create({ data: { ...values, tenantId: actor.tenantId } })
  const previousExtension = before && extension ? await extension.read(tx, actor, row.id) : null
  if (extension) await extension.save(tx, actor, row.id, data.extension)
  const nextExtension = extension ? await extension.read(tx, actor, row.id) : null
  await recordDomainAuditEvent(tx, { tenantId: actor.tenantId, actorUserId: actor.userId, actorRole: actor.role, requestId: actor.requestId, entityType: "CatalogItem", entityId: row.id, event: id ? "catalog.item.updated" : "catalog.item.created", before: before ? json({ ...before, extension: previousExtension }) : undefined, after: json({ ...row, extension: nextExtension }) })
  return row
}
