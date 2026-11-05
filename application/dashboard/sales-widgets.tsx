"use client"

import { CrmDashboardWidgets } from "@/modules/crm/components/dashboard-widgets"
import { ProjectDashboardWidgets } from "@/modules/real-estate/components/dashboard-widgets"
import { DocumentDashboardWidgets } from "@/modules/sales-documents/components/dashboard-widgets"
import type { DashboardDisplaySettings } from "@/components/dashboard/widgets"
import type { SalesDashboard, DashboardFilterContext } from "./types"

export function SalesWidgets({ data, settings, context, section }: { data: SalesDashboard; settings: DashboardDisplaySettings; context: DashboardFilterContext; section?: "crm" | "projects" | "documents" }) {
  return <>
    {(!section || section === "crm") && <CrmDashboardWidgets data={data} settings={settings} links={context.links} />}
    {(!section || section === "projects") && <ProjectDashboardWidgets projects={data.projects} />}
    {(!section || section === "documents") && <DocumentDashboardWidgets data={data} settings={settings} links={context.links} />}
  </>
}
