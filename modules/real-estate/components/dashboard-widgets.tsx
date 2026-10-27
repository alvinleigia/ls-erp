"use client"
import { useTerminology } from "@/platform/terminology/provider"

import { Section } from "@/components/erp/section"
import { ViewAll, Metrics, PreviewTable, recordLink } from "@/components/dashboard/widgets"
import type { ProjectDashboard } from "../dashboard-types"

export function ProjectDashboardWidgets({ projects }: ProjectDashboard) {
  const term = useTerminology()
  return <>
    {projects && <Section title="Real Estate" description={`Active ${term("realEstate.project.plural", "projects")} and ${term("realEstate.subproject.plural", "subprojects")} you can access.`} actions={<ViewAll href="/crm/projects">{term("realEstate.project.plural", "View projects", "View {label}")}</ViewAll>}>
      <Metrics items={[{ label: term("realEstate.project.plural", "Active projects", "Active {label}"), value: projects.active, hint: term("realEstate.project.plural", "Top-level projects now", "Top-level {label} now") }, { label: term("realEstate.subproject.plural", "Active subprojects", "Active {label}"), value: projects.subprojects, hint: term("realEstate.project.plural", "Within active parent projects", "Within active parent {label}") }]} />
      <p className="text-sm text-muted-foreground">{`First six ${term("realEstate.project.plural", "projects")} by name. ${term("crm.enquiry.plural", "Enquiries")} were created in the selected period; ${term("crm.opportunity.plural", "opportunities")} are currently open. Includes ${term("realEstate.subproject.singular", "subproject")} sales. Sales filters affect enquiry and opportunity counts, not project totals.`}</p>
      <PreviewTable columns={[term("realEstate.project.singular", "Project"), term("crm.enquiry.plural", "New enquiries", "New {label}"), term("crm.opportunity.plural", "Open opportunities", "Open {label}")]} rows={projects.items.map(row => ({ key: row.id, cells: [recordLink("/crm/projects", row.id, row.name), row.enquiries ?? "—", row.opportunities ?? "—"] }))} empty={term("realEstate.project.plural", "No active projects.", "No active {label}.")} />
    </Section>}
  </>
}
