"use client"

import type { ReactNode } from "react"
import Link from "next/link"
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"
import { Surface } from "@/components/erp/page"
import { Button } from "@/components/ui/button"
import { formatDecimalCurrency } from "@/lib/formatting"
import type { AppSettingsPayload } from "@/types/scheduling"
import type { DashboardCount, DashboardValue } from "@/types/dashboard"

export function ViewAll({ href, children }: { href: string; children: ReactNode }) {
  return <Button variant="outline" size="sm" asChild><Link href={href}>{children}</Link></Button>
}
export function Metrics({ items }: { items: { label: string; value: number | string; hint: string; href?: string }[] }) {
  return <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{items.map(item => <Surface key={item.label}>
    <p className="text-sm text-muted-foreground">{item.label}</p>
    <p className="text-2xl font-semibold">{item.href ? <Link className="underline underline-offset-4" href={item.href}>{item.value}<span className="sr-only"> {item.label}</span></Link> : item.value}</p>
    <p className="text-xs text-muted-foreground">{item.hint}</p>
  </Surface>)}</div>
}
export function PreviewTable({ columns, rows, empty }: { columns: string[]; rows: { key: string; cells: ReactNode[] }[]; empty: string }) {
  return <div className="overflow-x-auto"><table className="w-full text-sm">
    <thead><tr className="border-b text-muted-foreground">{columns.map(column => <th key={column} scope="col" className="px-2 py-3 text-left font-medium">{column}</th>)}</tr></thead>
    <tbody>{rows.length ? rows.map(row => <tr key={row.key} className="border-b last:border-0">{row.cells.map((cell, i) => <td key={i} className="px-2 py-3 align-top">{cell}</td>)}</tr>) : <tr><td colSpan={columns.length} className="py-6 text-center text-muted-foreground">{empty}</td></tr>}</tbody>
  </table></div>
}
export function CountChart({ rows, noun = "Records" }: { rows: DashboardCount[]; noun?: string }) {
  if (!rows.length) return <p className="py-8 text-center text-sm text-muted-foreground">No matching records.</p>
  return <div className="w-full" style={{ height: Math.max(190, rows.length * 42 + 35) }}>
    <ResponsiveContainer width="100%" height="100%"><BarChart data={rows} layout="vertical" margin={{ left: 0, right: 20 }}>
      <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="var(--border)" />
      <XAxis type="number" allowDecimals={false} fontSize={12} stroke="var(--muted-foreground)" />
      <YAxis type="category" dataKey="label" width={125} fontSize={12} stroke="var(--muted-foreground)" tickFormatter={v => String(v).length > 19 ? `${String(v).slice(0, 18)}…` : String(v)} />
      <Tooltip contentStyle={{ backgroundColor: "var(--popover)", color: "var(--popover-foreground)", borderColor: "var(--border)", borderRadius: 8 }} />
      <Bar dataKey="count" name={noun} fill="#38bdf8" radius={[0, 4, 4, 0]} maxBarSize={32} isAnimationActive={false} label={{ position: "right", fill: "var(--foreground)", fontSize: 12 }} />
    </BarChart></ResponsiveContainer>
  </div>
}
export const recordLink = (path: string, id: string, title: string) => <Link className="font-medium underline underline-offset-4" href={`${path}/${id}`}>{title}</Link>
export const percent = (value: number | null) => value === null ? "—" : `${value}%`

export type DashboardDisplaySettings = Pick<AppSettingsPayload, "numberFormat" | "currencySymbolPlacement">
export function ValuesTable({ rows, noun, settings }: { rows: DashboardValue[]; noun: string; settings: DashboardDisplaySettings }) {
  return <PreviewTable columns={["Currency", noun, "Value"]} rows={rows.map(row => ({ key: row.currency, cells: [row.currency, row.count, formatDecimalCurrency(row.amount, row.currency, settings)] }))} empty="No values to report." />
}
