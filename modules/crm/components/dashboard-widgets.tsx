"use client"
import { useTerminology } from "@/platform/terminology/provider"

import { Section } from "@/components/erp/section"
import { ViewAll, Metrics, PreviewTable, CountChart, recordLink, percent, ValuesTable, type DashboardDisplaySettings } from "@/components/dashboard/widgets"
import { useDateFormatter } from "@/hooks/use-date-formatter"
import type { CrmDashboard } from "../dashboard-types"

export function CrmDashboardWidgets({ data, settings }: { data: CrmDashboard; settings: DashboardDisplaySettings }) {
  const term = useTerminology()
  const { formatDate } = useDateFormatter()
  const { enquiries, opportunities, activities } = data
  return <>
    {(enquiries || opportunities || activities) && <div className="space-y-5">
      <div><h2 className="text-xl font-semibold">CRM and sales</h2><p className="text-sm text-muted-foreground">Your accessible records. Period figures follow the selected dates; open work shows the current position.</p></div>
      <Metrics items={[
        ...(enquiries ? [{ label: term("crm.enquiry.plural", "New enquiries", "New {label}"), value: enquiries.total, hint: "Created in selected period" }, ...(enquiries.converted !== null ? [{ label: term("crm.enquiry.singular", "Enquiry conversion", "{label} conversion"), value: percent(enquiries.conversionPercent), hint: `${enquiries.converted} of ${enquiries.total} period ${term("crm.enquiry.plural", "enquiries")} now have ${term("crm.opportunity.singular", "an opportunity", "a linked {label}")}` }] : [])] : []),
        ...(opportunities ? [{ label: term("crm.opportunity.plural", "Open opportunities", "Open {label}"), value: opportunities.open, hint: "Active pipeline now" }, { label: term("crm.opportunity.plural", "Won opportunities", "Won {label}"), value: opportunities.won, hint: `${opportunities.lost} lost · closed in selected period` }, { label: "Win rate", value: percent(opportunities.winPercent), hint: "Won ÷ (won + lost) in period" }] : []),
        ...(activities ? [{ label: "Completed calls", value: activities.calls, hint: `${activities.connected} connected · completed in period` }, { label: term("crm.activity.plural", "Completed activities", "Completed {label}"), value: activities.completed, hint: "Completed in selected period" }, { label: "Overdue follow-ups", value: activities.overdue, hint: term("crm.activity.plural", "Open activities past their due time", "Open {label} past their due time") }] : []),
      ]} />
      <div className="grid gap-5 lg:grid-cols-2">
        {enquiries && <Section title={term("crm.enquiry.singular", "Enquiry status", "{label} status")} description={term("crm.enquiry.plural", "Current status of enquiries created in the selected period.", "Current status of {label} created in the selected period.")} actions={<ViewAll href="/crm/enquiries">{term("crm.enquiry.plural", "View enquiries", "View {label}")}</ViewAll>}><CountChart rows={enquiries.statuses} noun={term("crm.enquiry.plural", "Records")} /></Section>}
        {opportunities && <Section title="Open pipeline by stage" description={term("crm.opportunity.singular", "Eight largest stages by opportunity count, across active pipelines.", "Eight largest stages by {label} count, across active pipelines.")} actions={<ViewAll href="/crm/opportunities">{term("crm.opportunity.plural", "View opportunities", "View {label}")}</ViewAll>}><CountChart rows={opportunities.stages} noun={term("crm.opportunity.plural", "Records")} /><ValuesTable rows={opportunities.values} noun={term("crm.opportunity.plural", "Open deals", "Open {label}")} settings={settings} /></Section>}
        {activities && <>
          <Section title={term("crm.activity.plural", "Completed activities by type", "Completed {label} by type")} description="Top eight recorded types in the period, including configured site visits." actions={<ViewAll href="/crm/activities?state=completed">{term("crm.activity.plural", "View completed activities", "View completed {label}")}</ViewAll>}><CountChart rows={activities.types} noun={term("crm.activity.plural", "Records")} /></Section>
          <Section title="Next follow-ups" description={term("crm.activity.plural", "First six open activities by due date, including overdue work.", "First six open {label} by due date, including overdue work.")} actions={<ViewAll href="/crm/activities">{term("crm.activity.plural", "View activities", "View {label}")}</ViewAll>}><PreviewTable columns={[term("crm.activity.singular", "Activity"), "Type", "Due"]} rows={activities.upcoming.map(row => ({ key: row.id, cells: [recordLink("/crm/activities", row.id, row.title), row.type, formatDate(row.dueOn)] }))} empty="No open follow-ups." /></Section>
        </>}
      </div>
    </div>}
  </>
}
