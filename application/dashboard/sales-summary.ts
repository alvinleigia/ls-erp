import type { Prisma } from "@prisma/client"
import { crmDashboard, dashboardSalesScopes } from "@/modules/crm/dashboard"
import { enquiryScope } from "@/modules/crm/policy"
import { projectDashboard } from "@/modules/real-estate/dashboard"
import { documentDashboard } from "@/modules/sales-documents/dashboard"
import type { ModuleFlag } from "@/platform/modules"
import type { BusinessActor } from "@/platform/policy"
import type { DashboardPeriod } from "@/types/dashboard"
import type { SalesDashboard } from "./types"

// The caller supplies its authorized tenant/RLS context; modules retain their
// own activation, permission, record-scope and bounded-query rules.
export async function salesDashboard(tx: Prisma.TransactionClient, actor: BusinessActor, flags: ModuleFlag[], period: DashboardPeriod): Promise<SalesDashboard> {
  const [crm, projects, documents] = await Promise.all([
    crmDashboard(tx, actor, flags, period),
    projectDashboard(tx, actor, flags, dashboardSalesScopes(actor, flags, period)),
    documentDashboard(tx, actor, flags, period, enquiryScope(actor)),
  ])
  return { ...crm, projects, ...documents }
}
