import type { CatalogImportProfile } from "@/modules/catalog/import-template"
import { BusinessError } from "@/platform/policy"
import { requirePermission } from "@/platform/access/policy"
import { propertyCatalogExtension } from "./catalog-extension"
import { activeProjectBranch } from "./hierarchy"
import { projectScope } from "./access"
export const propertyCatalogImportProfile: CatalogImportProfile = {
  key: "realEstate", label: "Property units",
  columns: [
    { key: "project_code", required: true, help: "Exact code of the project or hierarchy node that owns this unit. Company and office are inherited from its root." },
    { key: "property_category", required: true, help: "Exact active property category name, for example Plot or Apartment." },
    { key: "launch_phase_code", help: "Optional launch-phase code belonging to the same root project. Leave blank for unphased stock." },
    { key: "area", help: "Optional positive area, plain number with up to four decimals." },
    { key: "area_unit", help: "SQ_M or SQ_FT; required when area is entered.", options: ["SQ_M", "SQ_FT"] },
    { key: "bedrooms", help: "Optional whole number from 0 to 100; 0 for studio." },
  ],
  async authorize(tx, actor) {
    requirePermission(actor, ["projects.read", "projects.edit"])
    if (!await propertyCatalogExtension.scope(tx, actor)) throw new BusinessError(403, "Real Estate is not available to your account.")
  },
  async extend(tx, actor, row) {
    if (row.kind.toUpperCase() !== "UNIT") throw new BusinessError(400, "Property imports require kind UNIT.")
    const project = await tx.realEstateProject.findFirst({ where: { AND: [projectScope(actor, "edit"), { code: row.project_code.toUpperCase(), ...activeProjectBranch }] }, select: { id: true, rootId: true } })
    if (!project) throw new BusinessError(400, "project_code: Choose an active project code you can edit.")
    const category = await tx.realEstatePropertyCategory.findFirst({ where: { tenantId: actor.tenantId, nameKey: row.property_category.toLowerCase(), archived: false }, select: { id: true } })
    if (!category) throw new BusinessError(400, "property_category: Use an exact active category name.")
    const phase = row.launch_phase_code ? await tx.realEstateLaunchPhase.findFirst({ where: { tenantId: actor.tenantId, projectId: project.rootId, code: row.launch_phase_code.toUpperCase() }, select: { id: true } }) : null
    if (row.launch_phase_code && !phase) throw new BusinessError(400, "launch_phase_code: Choose a phase code belonging to this root project.")
    if (row.area && !row.area_unit) throw new BusinessError(400, "area_unit: Required when area is entered.")
    if (row.bedrooms && !/^\d+$/.test(row.bedrooms)) throw new BusinessError(400, "bedrooms: Enter a whole number from 0 to 100.")
    return { extensionKey: "realEstate", extension: { projectId: project.id, categoryId: category.id, launchPhaseId: phase?.id ?? null, area: row.area, areaUnit: row.area_unit.toUpperCase() || "SQ_M", bedrooms: row.bedrooms ? Number(row.bedrooms) : null } }
  },
}
