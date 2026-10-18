import type { CrmDashboard } from "@/modules/crm/dashboard-types"
import type { ProjectDashboard } from "@/modules/real-estate/dashboard-types"
import type { DocumentDashboard } from "@/modules/sales-documents/dashboard-types"

export type SalesDashboard = CrmDashboard & ProjectDashboard & DocumentDashboard
