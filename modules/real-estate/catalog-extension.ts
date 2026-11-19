import { activeProjectBranch, projectBranch, projectBreadcrumbs } from "./hierarchy"
import { z } from "zod"
import { Prisma } from "@prisma/client"
import type { CatalogExtension } from "@/modules/catalog/contracts"
import { moduleEnabled } from "@/platform/modules"
import { permits, requirePermission } from "@/platform/access/policy"
import { BusinessError } from "@/platform/policy"
import { projectScope } from "./service"
import { resolvePropertyChoice } from "./choice-service"
import { readPropertyDocumentEvidence } from "./document-evidence"
import { launchReservationBlocks } from "./launch-phases"
export const unitDetailsSchema = z.object({
  projectId: z.string().min(1).max(100), categoryId: z.string().min(1).max(100),
  launchPhaseId: z.string().min(1).max(100).nullable().optional(),
  bedrooms: z.number().int().min(0).max(100).nullable().default(null),
  area: z.union([z.literal(""), z.string().regex(/^\d{1,12}(\.\d{1,4})?$/).refine(s => Number(s) > 0)]).default(""),
  areaUnit: z.enum(["SQ_FT", "SQ_M"]).default("SQ_FT"),
}).strict()
export const propertyCatalogExtension: CatalogExtension = {
  key: "realEstate",
  reservationBlocks: launchReservationBlocks,
  documentEvidence: readPropertyDocumentEvidence,
  async scope(tx, actor, contextId) {
    const flags = await tx.tenantModule.findMany({ where: { tenantId: actor.tenantId } })
    if (!moduleEnabled(flags, "realEstate") || !permits(actor, "projects.read")) return null
    return { propertyUnit: { is: { tenantId: actor.tenantId, project: { AND: [projectScope(actor), ...(contextId ? [projectBranch(contextId)] : [])] } } } }
  },
  async read(tx, actor, itemId) {
    const row = await tx.realEstateUnit.findUnique({ where: { tenantId_itemId: { tenantId: actor.tenantId, itemId } }, include: { launchPhase: { select: { id: true, name: true, status: true, opensAt: true } }, project: { select: { id: true, name: true, parentId: true, rootId: true, rootProject: { select: { id: true, name: true } }, parent: { select: { id: true, name: true } } } }, category: { select: { id: true, name: true } } } })
    return row ? { ...row, project: { ...row.project, pathName: (await projectBreadcrumbs(tx, actor.tenantId, row.projectId)).map(node => node.name).join(" / ") } } : null
  },
  async save(tx, actor, itemId, input) {
    requirePermission(actor, "projects.edit")
    const data = unitDetailsSchema.parse(input)
    const previous = await tx.realEstateUnit.findUnique({ where: { tenantId_itemId: { tenantId: actor.tenantId, itemId } } })
    const project = await tx.realEstateProject.findFirst({ where: { AND: [projectScope(actor, "edit"), { id: data.projectId }] }, select: { archived: true, parent: { select: { archived: true } } } })
    if (!project || (!await tx.realEstateProject.findFirst({ where: { tenantId: actor.tenantId, id: data.projectId, ...activeProjectBranch }, select: { id: true } }) && previous?.projectId !== data.projectId)) throw new BusinessError(400, "Choose an active, accessible project or subproject.")
    await resolvePropertyChoice(tx, actor.tenantId, "property-categories", data.categoryId, previous?.categoryId)
    const launchPhaseId = data.launchPhaseId === undefined ? previous?.launchPhaseId ?? null : data.launchPhaseId
    if (launchPhaseId) {
      const owner = await tx.realEstateProject.findFirst({ where: { tenantId: actor.tenantId, id: data.projectId }, select: { rootId: true } })
      if (!owner || !await tx.realEstateLaunchPhase.findFirst({ where: { tenantId: actor.tenantId, id: launchPhaseId, projectId: owner.rootId } })) throw new BusinessError(400, "Choose a launch phase belonging to this project.")
    }
    const values = { ...data, launchPhaseId, area: data.area ? new Prisma.Decimal(data.area) : null }
    await tx.realEstateUnit.upsert({ where: { tenantId_itemId: { tenantId: actor.tenantId, itemId } }, create: { tenantId: actor.tenantId, itemId, ...values }, update: values })
  },
}
