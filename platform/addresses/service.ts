import type { Prisma } from "@prisma/client"
import type { PermissionRun } from "@/platform/access/server"
import type { PermissionAction } from "@/platform/access/catalog"
import { permits } from "@/platform/access/policy"
import { BusinessError, type BusinessActor } from "@/platform/policy"
import { addressCreateSchema, addressUpdateSchema, addressQuerySchema, addressOwnerSchema, addressFieldsSchema, type AddressOwner, type AddressFields } from "./contracts"

type Tx = Prisma.TransactionClient
type Parent = { id: string; archived: boolean }
type Context = { run: PermissionRun; runLocked: PermissionRun; owner: (tx: Tx, actor: BusinessActor, owner: AddressOwner, action: PermissionAction, lock?: boolean) => Promise<Parent | null>; audit: (tx: Tx, actor: BusinessActor, event: string, id: string, before?: Prisma.InputJsonValue, after?: Prisma.InputJsonValue) => Promise<void> }
export const addressOwnerWhere = (owner: AddressOwner) => owner.kind === "PERSON" ? { contactId: owner.id, accountId: null } : { accountId: owner.id, contactId: null }
const resource = (owner: AddressOwner) => owner.kind === "PERSON" ? "contacts" : "accounts"
const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue
const flags = ["defaultCorrespondence", "defaultBilling", "defaultDelivery"] as const
export function createPartyAddressService(ctx: Context) {
  async function parent(tx: Tx, actor: BusinessActor, owner: AddressOwner, action: PermissionAction, lock = false) {
    const row = await ctx.owner(tx, actor, owner, action, lock)
    if (!row) throw new BusinessError(404, "Address owner not found within your record access.")
    return row
  }
  async function capabilities(tx: Tx, actor: BusinessActor, owner: AddressOwner, row: Parent) {
    const family = resource(owner), canEdit = permits(actor, `${family}.edit`) && !!await ctx.owner(tx, actor, owner, "edit")
    return { canCreate: !row.archived && canEdit, canEdit: !row.archived && canEdit, canArchive: permits(actor, `${family}.archive`) && !!await ctx.owner(tx, actor, owner, "archive") }
  }
  async function history(tx: Tx, actor: BusinessActor, owner: AddressOwner, event: string, before: unknown, after: unknown) {
    await ctx.audit(tx, actor, `crm.${owner.kind === "PERSON" ? "contact" : "account"}.address.${event}`, owner.id, before ? json(before) : undefined, json(after))
  }
  async function validate(tx: Tx, actor: BusinessActor, owner: AddressOwner, data: AddressFields, except?: string) {
    const where = { tenantId: actor.tenantId, ...addressOwnerWhere(owner), ...(except ? { id: { not: except } } : {}) }
    if (await tx.partyAddress.count({ where: { ...where, name: { equals: data.name, mode: "insensitive" } } })) throw new BusinessError(409, "This address name already exists. Edit or restore that address.")
    if (!data.archived && await tx.partyAddress.count({ where: { ...where, archived: false } }) >= 100) throw new BusinessError(409, "Archive an unused address before adding more than 100 active addresses.")
  }
  async function transferDefaults(tx: Tx, actor: BusinessActor, owner: AddressOwner, data: AddressFields, except?: string) {
    const enabled = flags.filter(flag => data[flag])
    if (!enabled.length) return
    const previous = await tx.partyAddress.findMany({ where: { tenantId: actor.tenantId, ...addressOwnerWhere(owner), ...(except ? { id: { not: except } } : {}), OR: enabled.map(flag => ({ [flag]: true })) }, orderBy: { id: "asc" } })
    for (const row of previous) {
      const after = await tx.partyAddress.update({ where: { id: row.id }, data: { ...Object.fromEntries(enabled.map(flag => [flag, false])), version: { increment: 1 } } })
      await history(tx, actor, owner, "default.changed", row, after)
    }
  }
  return {
    listPartyAddresses(owner: unknown, input: unknown) {
      const o = addressOwnerSchema.parse(owner), query = addressQuerySchema.parse(input)
      return ctx.run(`${resource(o)}.read`, async (tx, actor) => {
        const row = await parent(tx, actor, o, "read"), where = { tenantId: actor.tenantId, ...addressOwnerWhere(o), ...(query.status === "all" ? {} : { archived: query.status === "archived" }), ...(query.purpose ? { purposes: { has: query.purpose } } : {}), name: { contains: query.q, mode: "insensitive" as const } }
        const [items, total] = await Promise.all([tx.partyAddress.findMany({ where, orderBy: [{ name: "asc" }, { id: "asc" }], take: query.pageSize, skip: (query.page - 1) * query.pageSize }), tx.partyAddress.count({ where })])
        return { items: items.map(item => ({ ...item, ...addressFieldsSchema.parse(itemFields(item)) })), total, page: query.page, pageSize: query.pageSize, totalPages: Math.max(1, Math.ceil(total / query.pageSize)), ...await capabilities(tx, actor, o, row) }
      })
    },
    getPartyAddress(owner: unknown, id: string) {
      const o = addressOwnerSchema.parse(owner)
      return ctx.run(`${resource(o)}.read`, async (tx, actor) => {
        const row = await parent(tx, actor, o, "read"), item = await tx.partyAddress.findFirst({ where: { tenantId: actor.tenantId, ...addressOwnerWhere(o), id } })
        if (!item) throw new BusinessError(404, "Address not found.")
        return { ...item, ...addressFieldsSchema.parse(itemFields(item)), ...await capabilities(tx, actor, o, row) }
      })
    },
    createPartyAddress(owner: unknown, input: unknown) {
      const o = addressOwnerSchema.parse(owner), data = addressCreateSchema.parse(input)
      return ctx.runLocked([`${resource(o)}.read`, `${resource(o)}.edit`], async (tx, actor) => {
        if ((await parent(tx, actor, o, "edit", true)).archived) throw new BusinessError(409, "Restore this owner before adding addresses.")
        await validate(tx, actor, o, data); await transferDefaults(tx, actor, o, data)
        const row = await tx.partyAddress.create({ data: { ...data, tenantId: actor.tenantId, ...addressOwnerWhere(o) } })
        await history(tx, actor, o, "created", undefined, row)
        return row
      })
    },
    updatePartyAddress(owner: unknown, id: string, input: unknown) {
      const o = addressOwnerSchema.parse(owner), { version, ...data } = addressUpdateSchema.parse(input)
      return ctx.runLocked([`${resource(o)}.read`, `${resource(o)}.edit`], async (tx, actor) => {
        const p = await parent(tx, actor, o, "edit", true), before = await tx.partyAddress.findFirst({ where: { tenantId: actor.tenantId, ...addressOwnerWhere(o), id } })
        if (!before) throw new BusinessError(404, "Address not found.")
        if (before.version !== version) throw new BusinessError(409, "This address changed. Reload before saving; your draft is retained.")
        if (before.archived !== data.archived && (!permits(actor, `${resource(o)}.archive`) || !await ctx.owner(tx, actor, o, "archive"))) throw new BusinessError(403, "Archive permission on this owner is required.")
        if (p.archived && !data.archived) throw new BusinessError(409, "Restore this owner before editing active addresses.")
        await validate(tx, actor, o, data, id); await transferDefaults(tx, actor, o, data, id)
        const row = await tx.partyAddress.update({ where: { id, version }, data: { ...data, version: { increment: 1 } } })
        await history(tx, actor, o, "updated", before, row)
        return row
      })
    },
  }
}
function itemFields(row: { name: string; purposes: string[]; values: Prisma.JsonValue; defaultCorrespondence: boolean; defaultBilling: boolean; defaultDelivery: boolean; archived: boolean }) {
  return { name: row.name, purposes: row.purposes, values: row.values, defaultCorrespondence: row.defaultCorrespondence, defaultBilling: row.defaultBilling, defaultDelivery: row.defaultDelivery, archived: row.archived }
}
