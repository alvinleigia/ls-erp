"use client"

import { Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"
import { Section } from "@/components/erp/section"
import type { ReactNode } from "react"

const colors = ["#2563eb", "#0d9488", "#d97706", "#dc2626", "#7c3aed", "#db2777", "#64748b"]
const tooltipStyle = { backgroundColor: "var(--popover)", color: "var(--popover-foreground)", borderColor: "var(--border)", borderRadius: 8 }
export type ReportChartRow = { label: string; value: number; secondary?: number }

// Charts consume already-authorized report responses. Their adjacent numbers
// remain available to keyboard/screen-reader users and when every count is zero.
export function ReportDonut({ title, description, rows }: { title: string; description: string; rows: ReportChartRow[] }) {
  const total = rows.reduce((sum, row) => sum + row.value, 0)
  return <Section title={title} description={description}>
    {total > 0 ? <div aria-hidden="true" className="h-52 min-w-0"><ResponsiveContainer width="100%" height="100%"><PieChart accessibilityLayer={false}>
      <Pie data={rows} dataKey="value" nameKey="label" innerRadius={52} outerRadius={85} paddingAngle={2} isAnimationActive={false}>
        {rows.map((row, i) => <Cell key={`${i}:${row.label}`} fill={colors[i % colors.length]} stroke="var(--card)" />)}
      </Pie><Tooltip contentStyle={tooltipStyle} itemStyle={{ color: "var(--popover-foreground)" }} labelStyle={{ color: "var(--popover-foreground)" }} />
    </PieChart></ResponsiveContainer></div> : <p className="py-8 text-center text-sm text-muted-foreground">No matching records for this chart.</p>}
    <ul className="space-y-2 text-sm">{rows.map((row, i) => <li key={`${i}:${row.label}`} className="flex items-start justify-between gap-3">
      <span className="flex min-w-0 items-start gap-2"><span aria-hidden="true" className="mt-1 size-3 shrink-0 rounded-sm" style={{ backgroundColor: colors[i % colors.length] }} />{row.label}</span>
      {" "}<span className="shrink-0 tabular-nums">{row.value.toLocaleString()} <span className="text-muted-foreground">({total ? (100 * row.value / total).toFixed(1) : "0.0"}%)</span></span>
    </li>)}</ul>
  </Section>
}

export function ReportBars({ title, description, context, rows, primary = "Records", secondary }: { title: string; description: string; context?: ReactNode; rows: ReportChartRow[]; primary?: string; secondary?: string }) {
  const hasValues = rows.some(row => row.value > 0 || (row.secondary || 0) > 0)
  return <Section title={title} description={description}>
    {context && <p className="text-sm text-muted-foreground">{context}</p>}
    {hasValues ? <div aria-hidden="true" className="min-w-0" style={{ height: Math.max(220, rows.length * (secondary ? 54 : 36) + 40) }}>
      <ResponsiveContainer width="100%" height="100%"><BarChart accessibilityLayer={false} data={rows} layout="vertical" margin={{ left: 0, right: 24 }}>
        <CartesianGrid horizontal={false} strokeDasharray="3 3" stroke="var(--border)" />
        <XAxis type="number" allowDecimals={false} fontSize={12} stroke="var(--muted-foreground)" />
        <YAxis type="category" dataKey="label" width={105} fontSize={12} stroke="var(--muted-foreground)" tickFormatter={value => String(value).length > 16 ? `${String(value).slice(0, 15)}…` : String(value)} />
        <Tooltip contentStyle={tooltipStyle} itemStyle={{ color: "var(--popover-foreground)" }} labelStyle={{ color: "var(--popover-foreground)" }} cursor={{ fill: "var(--muted)", opacity: 0.5 }} />
        <Bar dataKey="value" name={primary} fill={colors[0]} radius={[0, 4, 4, 0]} maxBarSize={22} isAnimationActive={false} />
        {secondary && <Bar dataKey="secondary" name={secondary} fill={colors[1]} radius={[0, 4, 4, 0]} maxBarSize={22} isAnimationActive={false} />}
      </BarChart></ResponsiveContainer>
    </div> : <p className="py-8 text-center text-sm text-muted-foreground">No matching records for this chart.</p>}
    <div className="flex flex-wrap gap-4 text-xs text-muted-foreground"><span><span aria-hidden="true" className="mr-1 inline-block size-2 rounded-sm" style={{ backgroundColor: colors[0] }} />{primary}</span>{secondary && <span><span aria-hidden="true" className="mr-1 inline-block size-2 rounded-sm" style={{ backgroundColor: colors[1] }} />{secondary}</span>}</div>
    <details className="text-sm"><summary className="cursor-pointer text-muted-foreground">Chart figures</summary><div className="mt-2 max-w-full overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr><th scope="col" className="p-2">Group</th><th scope="col" className="p-2">{primary}</th>{secondary && <th scope="col" className="p-2">{secondary}</th>}</tr></thead><tbody>{rows.map((row, i) => <tr key={`${i}:${row.label}`} className="border-t"><th scope="row" className="p-2 font-normal">{row.label}</th><td className="p-2 tabular-nums">{row.value.toLocaleString()}</td>{secondary && <td className="p-2 tabular-nums">{(row.secondary || 0).toLocaleString()}</td>}</tr>)}</tbody></table></div></details>
  </Section>
}
