"use client"

import type { ReactNode } from "react"
import Link from "next/link"
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"
import { Section } from "@/components/erp/section"
import { Surface } from "@/components/erp/page"
import { Button } from "@/components/ui/button"
import { useDateFormatter } from "@/hooks/use-date-formatter"
import { formatDecimalCurrency } from "@/lib/formatting"
import type { AppSettingsPayload } from "@/types/scheduling"
import type { DashboardCount, DashboardValue, SalesDashboard } from "@/types/dashboard"

function ViewAll({ href, children }: { href: string; children: ReactNode }) {
  return <Button variant="outline" size="sm" asChild><Link href={href}>{children}</Link></Button>
}
function Metrics({ items }: { items: { label: string; value: number | string; hint: string }[] }) {
  return <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{items.map(item => <Surface key={item.label}>
    <p className="text-sm text-muted-foreground">{item.label}</p>
    <p className="text-2xl font-semibold">{item.value}</p>
    <p className="text-xs text-muted-foreground">{item.hint}</p>
  </Surface>)}</div>
}
function PreviewTable({ columns, rows, empty }: { columns: string[]; rows: { key: string; cells: ReactNode[] }[]; empty: string }) {
  return <div className="overflow-x-auto"><table className="w-full text-sm">
    <thead><tr className="border-b text-muted-foreground">{columns.map(column => <th key={column} scope="col" className="px-2 py-3 text-left font-medium">{column}</th>)}</tr></thead>
    <tbody>{rows.length ? rows.map(row => <tr key={row.key} className="border-b last:border-0">{row.cells.map((cell, i) => <td key={i} className="px-2 py-3 align-top">{cell}</td>)}</tr>) : <tr><td colSpan={columns.length} className="py-6 text-center text-muted-foreground">{empty}</td></tr>}</tbody>
  </table></div>
}
function CountChart({ rows }: { rows: DashboardCount[] }) {
  if (!rows.length) return <p className="py-8 text-center text-sm text-muted-foreground">No matching records.</p>
  return <div className="w-full" style={{ height: Math.max(190, rows.length * 42 + 35) }}>
    <ResponsiveContainer width="100%" height="100%"><BarChart data={rows} layout="vertical" margin={{ left: 0, right: 20 }}>
      <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="var(--border)" />
      <XAxis type="number" allowDecimals={false} fontSize={12} stroke="var(--muted-foreground)" />
      <YAxis type="category" dataKey="label" width={125} fontSize={12} stroke="var(--muted-foreground)" tickFormatter={v => String(v).length > 19 ? `${String(v).slice(0, 18)}…` : String(v)} />
      <Tooltip contentStyle={{ backgroundColor: "var(--popover)", color: "var(--popover-foreground)", borderColor: "var(--border)", borderRadius: 8 }} />
      <Bar dataKey="count" name="Records" fill="#38bdf8" radius={[0, 4, 4, 0]} maxBarSize={32} isAnimationActive={false} label={{ position: "right", fill: "var(--foreground)", fontSize: 12 }} />
    </BarChart></ResponsiveContainer>
  </div>
}
const recordLink = (path: string, id: string, title: string) => <Link className="font-medium underline underline-offset-4" href={`${path}/${id}`}>{title}</Link>
const percent = (value: number | null) => value === null ? "—" : `${value}%`

export function SalesWidgets({ data, settings }: { data: SalesDashboard; settings: Pick<AppSettingsPayload, "numberFormat" | "currencySymbolPlacement"> }) {
  const { formatDate } = useDateFormatter()
  const money = (value: string, currency: string) => formatDecimalCurrency(value, currency, settings)
  const values = (rows: DashboardValue[], noun: string) => <PreviewTable columns={["Currency", noun, "Value"]} rows={rows.map(row => ({ key: row.currency, cells: [row.currency, row.count, money(row.amount, row.currency)] }))} empty="No values to report." />
  const { enquiries, opportunities, activities, projects, quotations, paymentPlans } = data
  return <>
    {(enquiries || opportunities || activities) && <div className="space-y-5">
      <div><h2 className="text-xl font-semibold">CRM and sales</h2><p className="text-sm text-muted-foreground">Your accessible records. Period figures follow the selected dates; open work shows the current position.</p></div>
      <Metrics items={[
        ...(enquiries ? [{ label: "New enquiries", value: enquiries.total, hint: "Created in selected period" }, ...(enquiries.converted !== null ? [{ label: "Enquiry conversion", value: percent(enquiries.conversionPercent), hint: `${enquiries.converted} of ${enquiries.total} period enquiries now have an opportunity` }] : [])] : []),
        ...(opportunities ? [{ label: "Open opportunities", value: opportunities.open, hint: "Active pipeline now" }, { label: "Won opportunities", value: opportunities.won, hint: `${opportunities.lost} lost · closed in selected period` }, { label: "Win rate", value: percent(opportunities.winPercent), hint: "Won ÷ (won + lost) in period" }] : []),
        ...(activities ? [{ label: "Completed calls", value: activities.calls, hint: `${activities.connected} connected · completed in period` }, { label: "Completed activities", value: activities.completed, hint: "Completed in selected period" }, { label: "Overdue follow-ups", value: activities.overdue, hint: "Open activities past their due time" }] : []),
      ]} />
      <div className="grid gap-5 lg:grid-cols-2">
        {enquiries && <Section title="Enquiry status" description="Current status of enquiries created in the selected period." actions={<ViewAll href="/crm/enquiries">View enquiries</ViewAll>}><CountChart rows={enquiries.statuses} /></Section>}
        {opportunities && <Section title="Open pipeline by stage" description="Eight largest stages by opportunity count, across active pipelines." actions={<ViewAll href="/crm/opportunities">View opportunities</ViewAll>}><CountChart rows={opportunities.stages} />{values(opportunities.values, "Open deals")}</Section>}
        {activities && <>
          <Section title="Completed activities by type" description="Top eight recorded types in the period, including configured site visits." actions={<ViewAll href="/crm/activities?state=completed">View completed activities</ViewAll>}><CountChart rows={activities.types} /></Section>
          <Section title="Next follow-ups" description="First six open activities by due date, including overdue work." actions={<ViewAll href="/crm/activities">View activities</ViewAll>}><PreviewTable columns={["Activity", "Type", "Due"]} rows={activities.upcoming.map(row => ({ key: row.id, cells: [recordLink("/crm/activities", row.id, row.title), row.type, formatDate(row.dueOn)] }))} empty="No open follow-ups." /></Section>
        </>}
      </div>
    </div>}
    {projects && <Section title="Real Estate" description="Active projects and subprojects you can access." actions={<ViewAll href="/crm/projects">View projects</ViewAll>}>
      <Metrics items={[{ label: "Active projects", value: projects.active, hint: "Top-level projects now" }, { label: "Active subprojects", value: projects.subprojects, hint: "Within active parent projects" }]} />
      <p className="text-sm text-muted-foreground">First six projects by name. Enquiries were created in the selected period; opportunities are currently open. Includes subproject sales.</p>
      <PreviewTable columns={["Project", "New enquiries", "Open opportunities"]} rows={projects.items.map(row => ({ key: row.id, cells: [recordLink("/crm/projects", row.id, row.name), row.enquiries ?? "—", row.opportunities ?? "—"] }))} empty="No active projects." />
    </Section>}
    {quotations && <Section title="Sales Documents" description="Quotations created in the selected period, using their latest saved values. Quoted values are not sales revenue." actions={<ViewAll href="/crm/quotations">View quotations</ViewAll>}>
      <Metrics items={[{ label: "Quotations created", value: quotations.total, hint: "Each quotation counted once, regardless of revisions" }]} />
      {values(quotations.values, "Quotations")}
      <h3 className="font-medium">Recent quotations · latest six</h3>
      <PreviewTable columns={["Quotation", "Created", "Version", "Quoted value"]} rows={quotations.recent.map(row => ({ key: row.id, cells: [recordLink("/crm/quotations", row.id, row.title), formatDate(row.createdAt), row.version, money(row.amount, row.currency)] }))} empty="No quotations created in this period." />
    </Section>}
    {paymentPlans && <Section title="Payment Plans" description="Proposed schedules from the latest saved quotation versions. These are planned amounts, not payment receipts or outstanding balances." actions={<ViewAll href="/crm/quotations">View quotations</ViewAll>}>
      <Metrics items={[{ label: "Quotations with plans", value: paymentPlans.documents, hint: "All accessible quotations · current versions" }, { label: "Upcoming instalments", value: paymentPlans.upcomingCount, hint: "Planned in the next 30 days, including today" }, { label: "Instalments without dates", value: paymentPlans.undated, hint: "A booking date is needed to calculate dates" }]} />
      {values(paymentPlans.values, "Upcoming instalments")}
      <h3 className="font-medium">Next planned instalments · earliest six</h3>
      <PreviewTable columns={["Quotation", "Instalment", "Planned date", "Planned amount"]} rows={paymentPlans.upcoming.map((row, index) => ({ key: `${row.id}-${index}`, cells: [recordLink("/crm/quotations", row.id, row.title), row.label, formatDate(row.dueDate), money(row.amount, row.currency)] }))} empty="No dated instalments planned in the next 30 days." />
    </Section>}
  </>
}
