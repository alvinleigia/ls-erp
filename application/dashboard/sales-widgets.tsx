"use client"

import { CrmDashboardWidgets } from "@/modules/crm/components/dashboard-widgets"
import { ProjectDashboardWidgets } from "@/modules/real-estate/components/dashboard-widgets"
import { DocumentDashboardWidgets } from "@/modules/sales-documents/components/dashboard-widgets"
import type { DashboardDisplaySettings } from "@/components/dashboard/widgets"
import type { SalesDashboard, DashboardFilterContext } from "./types"

export function SalesWidgets({ data, settings, context }: { data: SalesDashboard; settings: DashboardDisplaySettings; context: DashboardFilterContext }) {
  return <>
    <CrmDashboardWidgets data={data} settings={settings} links={context.links} />
    <ProjectDashboardWidgets projects={data.projects} />
    <DocumentDashboardWidgets data={data} settings={settings} links={context.links} />
  </>
}
