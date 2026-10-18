"use client"
import { useTerminology } from "@/platform/terminology/provider"

import { Section } from "@/components/erp/section"
import { ViewAll, Metrics, PreviewTable, recordLink, ValuesTable, type DashboardDisplaySettings } from "@/components/dashboard/widgets"
import { useDateFormatter } from "@/hooks/use-date-formatter"
import { formatDecimalCurrency } from "@/lib/formatting"
import type { DocumentDashboard } from "../dashboard-types"

export function DocumentDashboardWidgets({ data, settings }: { data: DocumentDashboard; settings: DashboardDisplaySettings }) {
  const term = useTerminology()
  const { formatDate } = useDateFormatter()
  const money = (value: string, currency: string) => formatDecimalCurrency(value, currency, settings)
  const { quotations, paymentPlans } = data
  return <>
    {quotations && <Section title="Sales Documents" description={term("salesDocuments.quotation.plural", "Quotations created in the selected period, using their latest saved values. Quoted values are not sales revenue.", "{label} created in the selected period, using their latest saved values. Quoted values are not sales revenue.")} actions={<ViewAll href="/crm/quotations">{term("salesDocuments.quotation.plural", "View quotations", "View {label}")}</ViewAll>}>
      <Metrics items={[{ label: term("salesDocuments.quotation.plural", "Quotations created", "{label} created"), value: quotations.total, hint: term("salesDocuments.quotation.singular", "Each quotation counted once, regardless of revisions", "Each {label} counted once, regardless of revisions") }]} />
      <ValuesTable rows={quotations.values} noun={term("salesDocuments.quotation.plural", "Quotations")} settings={settings} />
      <h3 className="font-medium">{term("salesDocuments.quotation.plural", "Recent quotations · latest six", "Recent {label} · latest six")}</h3>
      <PreviewTable columns={[term("salesDocuments.quotation.singular", "Quotation"), "Created", "Version", "Quoted value"]} rows={quotations.recent.map(row => ({ key: row.id, cells: [recordLink("/crm/quotations", row.id, row.title), formatDate(row.createdAt), row.version, money(row.amount, row.currency)] }))} empty={term("salesDocuments.quotation.plural", "No quotations created in this period.", "No {label} created in this period.")} />
    </Section>}
    {paymentPlans && <Section title={term("paymentPlans.paymentPlan.plural", "Payment Plans")} description={term("salesDocuments.quotation.singular", "Proposed schedules from the latest saved quotation versions. These are planned amounts, not payment receipts or outstanding balances.", "Proposed schedules from the latest saved {label} versions. These are planned amounts, not payment receipts or outstanding balances.")} actions={<ViewAll href="/crm/quotations">{term("salesDocuments.quotation.plural", "View quotations", "View {label}")}</ViewAll>}>
      <Metrics items={[{ label: `${term("salesDocuments.quotation.plural", "Quotations")} with ${term("paymentPlans.paymentPlan.plural", "plans")}`, value: paymentPlans.documents, hint: term("salesDocuments.quotation.plural", "All accessible quotations · current versions", "All accessible {label} · current versions") }, { label: "Upcoming instalments", value: paymentPlans.upcomingCount, hint: "Planned in the next 30 days, including today" }, { label: "Instalments without dates", value: paymentPlans.undated, hint: "A booking date is needed to calculate dates" }]} />
      <ValuesTable rows={paymentPlans.values} noun="Upcoming instalments" settings={settings} />
      <h3 className="font-medium">Next planned instalments · earliest six</h3>
      <PreviewTable columns={[term("salesDocuments.quotation.singular", "Quotation"), "Instalment", "Planned date", "Planned amount"]} rows={paymentPlans.upcoming.map((row, index) => ({ key: `${row.id}-${index}`, cells: [recordLink("/crm/quotations", row.id, row.title), row.label, formatDate(row.dueDate), money(row.amount, row.currency)] }))} empty="No dated instalments planned in the next 30 days." />
    </Section>}
  </>
}
