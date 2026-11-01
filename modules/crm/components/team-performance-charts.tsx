"use client"

import { Select } from "@/components/erp/controls"
import { useTerminology } from "@/platform/terminology/provider"
import { teamMetricLabel, type TeamMetric, type TeamPerformanceResponse } from "../team-performance-contract"
import { ReportBars, ReportDonut } from "./report-charts"

export type MemberChartComparison = "enquiries" | "outcomes" | "workload" | "followup" | "calls"

export function TeamPerformanceCharts({ data, comparison, onComparisonChange }: { data: TeamPerformanceResponse; comparison: MemberChartComparison; onComparisonChange: (value: MemberChartComparison) => void }) {
  const term = useTerminology()
  const label = (metric: TeamMetric) => teamMetricLabel(term, metric)
  const totals = data.totals
  const rows = (keys: TeamMetric[]) => keys.map(key => ({ label: label(key), value: totals[key] }))
  const choices: Record<MemberChartComparison, { primary: TeamMetric; secondary: TeamMetric }> = {
    enquiries: { primary: "enquiries", secondary: "converted" },
    outcomes: { primary: "won", secondary: "lost" },
    workload: { primary: "activitiesOpen", secondary: "activitiesInProgress" },
    followup: { primary: "activitiesOverdue", secondary: "activitiesDueToday" },
    calls: { primary: "callsCompleted", secondary: "connected" },
  }
  const selected = choices[comparison]
  return <div className="space-y-5">
    <div><h2 className="text-lg font-semibold">Team insights</h2><p className="text-sm text-muted-foreground">Totals cover every matching member and page, including the member search. Charts follow the report filters and your record access.</p></div>
    <div className="grid min-w-0 gap-5 xl:grid-cols-2">
      <ReportDonut title={term("crm.enquiry.singular", "Enquiry status mix", "{label} status mix")} description="Created in the selected period, grouped by their current status. Conversion is shown separately because it overlaps statuses." rows={rows(["new", "contacted", "qualified", "closed"])} />
      <ReportDonut title={term("crm.enquiry.singular", "Enquiry conversion", "{label} conversion")} description="Created in the selected period. Converted means a linked opportunity you can read; the remainder has no readable linked opportunity." rows={[{ label: label("converted"), value: totals.converted }, { label: "Without a readable linked opportunity", value: totals.enquiries - totals.converted }]} />
      <ReportDonut title="Closed opportunity outcomes" description="Won and lost opportunities closed in the selected period. This is the win/loss mix, not the enquiry conversion rate." rows={rows(["won", "lost"])} />
      <ReportDonut title="Completed call outcomes" description="Calls completed in the selected period, credited to their current assignee. Missing or unrecognized outcomes stay unrecorded." rows={rows(["connected", "noAnswer", "busy", "voicemail", "wrongNumber", "notInterested", "unknownOutcome"])} />
      <ReportBars title="Activity workload and delivery" description="Open, in-progress, overdue and due-today are current across all dates. Completed uses completion dates in the selected period. Overdue and due-today overlap pending work; these bars must not be added together." rows={rows(["activitiesOpen", "activitiesInProgress", "activitiesOverdue", "activitiesDueToday", "activitiesCompleted"])} />
      <ReportDonut title="Open pipeline follow-up coverage" description="Current readable open opportunities across all dates. Coverage means at least one directly linked readable open or in-progress activity; it does not mean the follow-up is on time." rows={[{ label: "With open follow-up", value: totals.pipeline - totals.gaps }, { label: "Without open follow-up", value: totals.gaps }]} />
    </div>
    <label className="flex max-w-sm flex-col gap-1 text-sm">Member chart comparison<Select aria-label="Member chart comparison" value={comparison} onValueChange={value => onComparisonChange(value as MemberChartComparison)}><option value="enquiries">Enquiries and conversions</option><option value="outcomes">Won and lost opportunities</option><option value="workload">Open and in-progress activities</option><option value="followup">Overdue and due-today activities</option><option value="calls">Completed and connected calls</option></Select></label>
    <ReportBars title="Member comparison" description={`Showing the ${data.items.length} members on table page ${data.page} of ${data.totalPages}, in the same sort order. Change the table page, size or search to compare other members. Measures use the date bases described above and can overlap.`} primary={label(selected.primary)} secondary={label(selected.secondary)} rows={data.items.map(row => ({ label: row.name, value: row[selected.primary], secondary: row[selected.secondary] }))} />
  </div>
}
