import type { Prisma } from "@prisma/client"
import { moduleEnabled, type ModuleFlag } from "@/platform/modules"
import { permits } from "@/platform/access/policy"
import type { BusinessActor } from "@/platform/policy"
import { projectScope } from "./service"
import type { ProjectDashboard } from "./dashboard-types"

export type ProjectSalesScopes = {
  enquiries: Prisma.CrmEnquiryWhereInput | null
  opportunities: Prisma.CrmOpportunityWhereInput | null
}
export async function projectDashboard(tx: Prisma.TransactionClient, actor: BusinessActor, flags: ModuleFlag[], sales: ProjectSalesScopes): Promise<ProjectDashboard["projects"]> {
  if (!moduleEnabled(flags, "realEstate") || !permits(actor, "projects.read")) return null
  const where = { AND: [projectScope(actor)], archived: false, parentId: null }
  const [active, subprojects, items] = await Promise.all([
    tx.realEstateProject.count({ where }),
    tx.realEstateProject.count({ where: { AND: [projectScope(actor)], archived: false, parentId: { not: null }, parent: { archived: false } } }),
    tx.realEstateProject.findMany({ where, select: { id: true, name: true, _count: sales.enquiries || sales.opportunities ? { select: {
      ...(sales.enquiries ? { enquiryContexts: { where: { enquiry: sales.enquiries } } } : {}),
      ...(sales.opportunities ? { opportunityContexts: { where: { opportunity: sales.opportunities } } } : {}),
    } } : false }, orderBy: [{ name: "asc" }, { id: "asc" }], take: 6 }),
  ])
  return { active, subprojects, items: items.map(row => ({ id: row.id, name: row.name, enquiries: sales.enquiries ? row._count.enquiryContexts : null, opportunities: sales.opportunities ? row._count.opportunityContexts : null })) }
}
