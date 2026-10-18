"use client"

import { CrmDashboardWidgets } from "@/modules/crm/components/dashboard-widgets"
import { ProjectDashboardWidgets } from "@/modules/real-estate/components/dashboard-widgets"
import { DocumentDashboardWidgets } from "@/modules/sales-documents/components/dashboard-widgets"
import type { DashboardDisplaySettings } from "@/components/dashboard/widgets"
import type { SalesDashboard } from "./types"

export function SalesWidgets({ data, settings }: { data: SalesDashboard; settings: DashboardDisplaySettings }) {
  return <>
    <CrmDashboardWidgets data={data} settings={settings} />
    <ProjectDashboardWidgets projects={data.projects} />
    <DocumentDashboardWidgets data={data} settings={settings} />
  </>
}
