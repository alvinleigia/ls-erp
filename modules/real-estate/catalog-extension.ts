import { z } from "zod"
import { Prisma } from "@prisma/client"
import type { CatalogExtension } from "@/modules/catalog/contracts"
import { moduleEnabled } from "@/platform/modules"
import { permits, requirePermission } from "@/platform/access/policy"
import { BusinessError } from "@/platform/policy"
import { projectScope } from "./service"
import { resolvePropertyChoice } from "./choice-service"
export const unitDetailsSchema = z.object({
  projectId: z.string().min(1).max(100), categoryId: z.string().min(1).max(100),
  bedrooms: z.number().int().min(0).max(100).nullable().default(null),
  area: z.union([z.literal(""), z.string().regex(/^\d{1,12}(\.\d{1,4})?$/).refine(s => Number(s) > 0)]).default(""),
  areaUnit: z.enum(["SQ_FT", "SQ_M"]).default("SQ_FT"),
}).strict()
export const propertyCatalogExtension: CatalogExtension = {
  key: "realEstate",
  async scope(tx, actor, contextId) {
    const flags = await tx.tenantModule.findMany({ where: { tenantId: actor.tenantId } })
    if (!moduleEnabled(flags, "realEstate") || !permits(actor, "projects.read")) return null
    return { propertyUnit: { is: { tenantId: actor.tenantId, project: { AND: [projectScope(actor), ...(contextId ? [{ OR: [{ id: contextId }, { parentId: contextId }] }] : [])] } } } }
  },
  async read(tx, actor, itemId) {
    return tx.realEstateUnit.findUnique({ where: { tenantId_itemId: { tenantId: actor.tenantId, itemId } }, include: { project: { select: { id: true, name: true, parentId: true, parent: { select: { id: true, name: true } } } }, category: { select: { id: true, name: true } } } })
  },
  async save(tx, actor, itemId, input) {
    requirePermission(actor, "projects.edit")
    const data = unitDetailsSchema.parse(input)
    const previous = await tx.realEstateUnit.findUnique({ where: { tenantId_itemId: { tenantId: actor.tenantId, itemId } } })
    const project = await tx.realEstateProject.findFirst({ where: { AND: [projectScope(actor, "edit"), { id: data.projectId }] }, select: { archived: true, parent: { select: { archived: true } } } })
    if (!project || ((project.archived || project.parent?.archived) && previous?.projectId !== data.projectId)) throw new BusinessError(400, "Choose an active, accessible project or subproject.")
    await resolvePropertyChoice(tx, actor.tenantId, "property-categories", data.categoryId, previous?.categoryId)
    const values = { ...data, area: data.area ? new Prisma.Decimal(data.area) : null }
    await tx.realEstateUnit.upsert({ where: { tenantId_itemId: { tenantId: actor.tenantId, itemId } }, create: { tenantId: actor.tenantId, itemId, ...values }, update: values })
  },
}
