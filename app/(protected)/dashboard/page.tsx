"use client"

import * as React from "react"
import { PageHeader, pageClass, Surface } from "@/components/erp/page"
import { Section } from "@/components/erp/section"
import { Select } from "@/components/erp/controls"
import { Button } from "@/components/ui/button"
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"
import {
  CalendarClockIcon,
  CreditCardIcon,
  ScissorsIcon,
  UsersIcon,
} from "lucide-react"
import type { DateRange } from "react-day-picker"

import { DateRangePicker } from "@/components/date-range-picker"
import { useDateFormatter } from "@/hooks/use-date-formatter"
import { formatCurrencyFromCents } from "@/lib/formatting"
import type { AppSettingsPayload } from "@/types/scheduling"
import { useBusinessModules } from "@/platform/module-provider"
import { SalesWidgets } from "@/components/dashboard/sales-widgets"
import type { SalesDashboard } from "@/types/dashboard"

type DashboardSummary = {
  sales: SalesDashboard
  visibility: {
    appointments: boolean
    leaves: boolean
    services: boolean
    inventory: boolean
  }
  range: {
    label: string
    startDate: string
    endDate: string
  }
  kpis: {
    revenueCents: number
    revenueTodayCents: number
    appointments: number
    appointmentsToday: number
    distinctCustomers: number
    pendingLeaves: number
    activeServices: number
    activeStaff: number
  }
  series: {
    daily: Array<{
      date: string
      label: string
      revenueCents: number
      bookings: number
    }>
  }
  appointmentStatus: Array<{
    status: string
    count: number
  }>
  topServices: Array<{
    serviceId: string
    name: string
    bookings: number
    revenueCents: number
  }>
  staffUtilization: Array<{
    staffProfileId: string
    name: string
    bookings: number
    bookedMinutes: number
    utilizationPercent: number
  }>
  upcomingAppointments: Array<{
    id: string
    startAt: string
    status: string
    customerName: string
    staffName: string
    serviceName: string
    priceCents: number
  }>
  lowStock: Array<{
    id: string
    sku: string
    name: string
    categoryName: string
    onHandQty: number
    reorderPoint: number
    reorderQty: number
  }>
  generatedAt: string
}

const pieColors = ["#22c55e", "#38bdf8", "#f59e0b", "#f97316", "#ef4444", "#a855f7"]
const chartTooltipContentStyle = {
  backgroundColor: "var(--popover)",
  opacity: 1,
  border: "1px solid var(--border)",
  borderRadius: "0.5rem",
  boxShadow: "0 10px 25px rgba(0, 0, 0, 0.28)",
  color: "var(--popover-foreground)",
  padding: "8px 10px",
}
const chartTooltipLabelStyle = {
  color: "var(--muted-foreground)",
  fontSize: "12px",
}
const chartTooltipItemStyle = {
  color: "var(--popover-foreground)",
  fontSize: "12px",
  fontWeight: 500,
}

const normalizeStatusLabel = (status: string) =>
  status
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ")

const parseDateOnlyLocal = (value: string) => {
  const [year, month, day] = value.split("-").map(Number)
  return new Date(year, (month ?? 1) - 1, day ?? 1)
}

const toDateOnlyLocal = (value: Date) => {
  const year = value.getFullYear()
  const month = String(value.getMonth() + 1).padStart(2, "0")
  const day = String(value.getDate()).padStart(2, "0")
  return `${year}-${month}-${day}`
}

export default function DashboardPage() {
  const { flags, permissions, loading: modulesLoading } = useBusinessModules()
  const [range, setRange] = React.useState<"today" | "week" | "month" | "custom">("week")
  const [refresh, setRefresh] = React.useState(0)
  const [appliedCustom, setAppliedCustom] = React.useState<DateRange | undefined>()
  const [dateRange, setDateRange] = React.useState<DateRange | undefined>()
  const [settings, setSettings] = React.useState<
    Pick<
      AppSettingsPayload,
      "currency" | "currencySymbolPlacement" | "locale" | "numberFormat" | "firstDayOfWeek" | "timeZone"
    >
  >({})
  const [summary, setSummary] = React.useState<DashboardSummary | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)

  const { formatDate } = useDateFormatter()

  React.useEffect(() => {
    let mounted = true
    fetch("/api/settings/display", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) return null
        const data = (await response.json()) as { settings?: AppSettingsPayload }
        return data.settings ?? null
      })
      .then((data) => {
        if (!mounted || !data) return
        setSettings({
          currency: data.currency,
          currencySymbolPlacement: data.currencySymbolPlacement,
          locale: data.locale,
          numberFormat: data.numberFormat,
          firstDayOfWeek: data.firstDayOfWeek,
          timeZone: data.timeZone,
        })
      })
      .catch(() => undefined)

    return () => {
      mounted = false
    }
  }, [])

  React.useEffect(() => {
    if (modulesLoading) return
    const controller = new AbortController()
    const query = new URLSearchParams({ range })
    if (range === "custom" && appliedCustom?.from && appliedCustom?.to) {
      query.set("startDate", toDateOnlyLocal(appliedCustom.from))
      query.set("endDate", toDateOnlyLocal(appliedCustom.to))
    }

    setLoading(true)
    setError(null)

    fetch(`/api/dashboard/summary?${query.toString()}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) {
          const body = (await response.json().catch(() => null)) as { error?: string } | null
          throw new Error(body?.error || "Unable to load dashboard")
        }
        return (await response.json()) as DashboardSummary
      })
      .then((data) => {
        if (controller.signal.aborted) return
        setSummary(data)
      })
      .catch((fetchError) => {
        if (controller.signal.aborted) return
        setError(fetchError instanceof Error ? fetchError.message : "Unable to load dashboard")
      })
      .finally(() => {
        if (controller.signal.aborted) return
        setLoading(false)
      })

    return () => {
      controller.abort()
    }
  }, [range, appliedCustom, refresh, flags, permissions, modulesLoading])

  const rangeText = React.useMemo(() => {
    if (!summary?.range) return ""
    const from = parseDateOnlyLocal(summary.range.startDate)
    const to = parseDateOnlyLocal(summary.range.endDate)
    return `${formatDate(from)} - ${formatDate(to)}`
  }, [formatDate, summary])

  const revenueSeries = React.useMemo(
    () =>
      (summary?.series.daily ?? []).map((row) => ({
        ...row,
        revenue: Number((row.revenueCents / 100).toFixed(2)),
      })),
    [summary]
  )

  const headerCards = React.useMemo(() => {
    if (!summary) return []
    return [
      {
        label: "Revenue",
        visible: summary.visibility.appointments,
        value: formatCurrencyFromCents(summary.kpis.revenueCents, settings),
        hint: `Today ${formatCurrencyFromCents(summary.kpis.revenueTodayCents, settings)}`,
        icon: CreditCardIcon,
      },
      {
        label: "Appointments",
        visible: summary.visibility.appointments,
        value: String(summary.kpis.appointments),
        hint: `Today ${summary.kpis.appointmentsToday}`,
        icon: CalendarClockIcon,
      },
      {
        label: "Unique customers",
        visible: summary.visibility.appointments,
        value: String(summary.kpis.distinctCustomers),
        hint: `${summary.kpis.activeStaff} active staff`,
        icon: UsersIcon,
      },
      {
        label: "Pending leaves",
        visible: summary.visibility.leaves,
        value: String(summary.kpis.pendingLeaves),
        hint: "Awaiting approval",
        icon: CalendarClockIcon,
      },
      {
        label: "Active services",
        visible: summary.visibility.services,
        value: String(summary.kpis.activeServices),
        hint: "Available services",
        icon: ScissorsIcon,
      },
    ].filter(card => card.visible)
  }, [settings, summary])

  const formatUpcomingDate = React.useCallback(
    (value: string) => formatDate(value),
    [formatDate]
  )

  const hasSales = !!summary && Object.values(summary.sales).some(Boolean)
  const hasPeriod = !!summary && (summary.visibility.appointments || hasSales)

  const formatUpcomingTime = React.useCallback(
    (value: string) =>
      new Date(value).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
        timeZone: settings.timeZone,
      }),
    [settings.timeZone]
  )


  return (
    <div className={`${pageClass} [contain:inline-size]`}>
      <PageHeader title="Dashboard" description="Business activity, bookings and operational summaries." />
      <Surface>
        <div className="flex flex-wrap items-center gap-3">
          {!modulesLoading && hasPeriod && <>
          <Select aria-label="Period" value={range} onValueChange={value => {
            setRange(value as typeof range)
            if (value !== "custom") { setDateRange(undefined); setAppliedCustom(undefined) }
          }}>
            <option value="today">Today</option><option value="week">This week</option><option value="month">This month</option>
            {range === "custom" && <option value="custom">Custom range</option>}
          </Select>
          <DateRangePicker value={dateRange} numberOfMonths={1} placeholder="Custom date range" onChange={next => {
            setDateRange(next)
            if (next?.from && next?.to) { setAppliedCustom(next); setRange("custom") }
          }} />
          </>}
          <Button variant="outline" onClick={() => setRefresh(value => value + 1)} disabled={loading}>Refresh</Button>
        </div>
        {!modulesLoading && hasPeriod && <p className="text-sm text-muted-foreground">{rangeText || "Choose a period to view metrics."}</p>}
      </Surface>
      {loading || modulesLoading ? <p role="status" className="text-sm text-muted-foreground">Loading metrics...</p> : error ? <Surface><p role="alert" className="text-sm text-destructive">{error}</p></Surface> : summary && <>
        {!hasSales && !Object.values(summary.visibility).some(Boolean) && <Surface>
          <p className="font-medium">No dashboard summaries available for your current modules.</p>
          <p className="text-sm text-muted-foreground">Open a module from the sidebar to get started.</p>
        </Surface>}
        {hasSales && <SalesWidgets data={summary.sales} settings={settings} />}
        {headerCards.length > 0 && <div className="grid gap-3 sm:grid-cols-[repeat(auto-fit,minmax(14rem,1fr))]">
          {headerCards.map(card => <Surface key={card.label}>
            <div className="flex items-center justify-between gap-2 text-sm text-muted-foreground"><span>{card.label}</span><card.icon className="size-4" aria-hidden="true" /></div>
            <p className="text-2xl font-semibold">{card.value}</p><p className="text-xs text-muted-foreground">{card.hint}</p>
          </Surface>)}
        </div>}

      {summary.visibility.appointments && <section className="grid gap-6 lg:grid-cols-[1.7fr_1fr]">
        <Section title="Revenue trend" description="Revenue and booking volume by day"><div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={revenueSeries}>
                <defs>
                  <linearGradient id="dashboardRevenueFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#22c55e" stopOpacity={0.4} />
                    <stop offset="100%" stopColor="#22c55e" stopOpacity={0.05} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#2a2a2a" />
                <XAxis dataKey="label" stroke="#9ca3af" fontSize={12} />
                <YAxis stroke="#9ca3af" fontSize={12} />
                <Tooltip
                  contentStyle={chartTooltipContentStyle}
                  labelStyle={chartTooltipLabelStyle}
                  itemStyle={chartTooltipItemStyle}
                  formatter={(value, name) => {
                    if (name === "revenue") {
                      return [formatCurrencyFromCents(Math.round(Number(value) * 100), settings), "Revenue"]
                    }
                    return [String(value), "Bookings"]
                  }}
                />
                <Area type="monotone" dataKey="revenue" stroke="#22c55e" strokeWidth={2} fill="url(#dashboardRevenueFill)" />
              </AreaChart>
            </ResponsiveContainer>
          </div></Section>

        <Section title="Appointment status mix" description="Status distribution in selected range"><div className="h-52">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={summary?.appointmentStatus ?? []} dataKey="count" nameKey="status" innerRadius={42} outerRadius={72} paddingAngle={3}>
                  {(summary?.appointmentStatus ?? []).map((_, index) => (
                    <Cell key={`status-${index}`} fill={pieColors[index % pieColors.length]} />
                  ))}
                </Pie>
                <Tooltip
                  content={({ active, payload }) => {
                    if (!active || !payload || payload.length === 0) return null
                    const row = payload[0] as { value?: number; payload?: { status?: string } }
                    const label = normalizeStatusLabel(String(row.payload?.status || "Status"))
                    return (
                      <div className="rounded-md border bg-popover px-2 py-1 text-popover-foreground shadow-lg">
                        <div className="text-xs font-medium">
                          {label}: {row.value ?? 0}
                        </div>
                      </div>
                    )
                  }}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
<div className="space-y-1 text-xs text-muted-foreground">
            {(summary?.appointmentStatus ?? []).slice(0, 5).map((row) => (
              <div key={row.status} className="flex items-center justify-between">
                <span>{normalizeStatusLabel(row.status)}</span>
                <span className="font-medium text-foreground">{row.count}</span>
              </div>
            ))}
          </div></Section>
      </section>}

      {summary.visibility.appointments && <section className="grid gap-6 lg:grid-cols-[1.2fr_1fr]">
        <Section title="Daily bookings" description="Booking count by day"><div className="h-64 min-w-0">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={summary?.series.daily ?? []}
                margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
                barCategoryGap="18%"
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#2a2a2a" />
                <XAxis dataKey="label" stroke="#9ca3af" fontSize={12} />
                <YAxis stroke="#9ca3af" fontSize={12} allowDecimals={false} />
                <Tooltip
                  contentStyle={chartTooltipContentStyle}
                  labelStyle={chartTooltipLabelStyle}
                  itemStyle={chartTooltipItemStyle}
                />
                <Bar dataKey="bookings" fill="#38bdf8" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div></Section>

        <Section title="Staff load" description="Booked time in selected range (8h/day baseline)"><div className="space-y-3">
            {(summary?.staffUtilization ?? []).length === 0 ? (
              <div className="text-sm text-muted-foreground">No staff bookings in selected range.</div>
            ) : (
              (summary?.staffUtilization ?? []).map((staff) => (
                <div key={staff.staffProfileId} className="rounded-xl border bg-muted/20 px-3 py-2">
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-medium">{staff.name}</span>
                    <span className="text-xs text-muted-foreground">{staff.bookings} bookings</span>
                  </div>
                  <div className="mt-2 h-2 rounded-full bg-muted">
                    <div className="h-2 rounded-full bg-emerald-500" style={{ width: `${staff.utilizationPercent}%` }} />
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {Math.round(staff.bookedMinutes / 60)}h {staff.bookedMinutes % 60}m booked ({staff.utilizationPercent}%)
                  </div>
                </div>
              ))
            )}
          </div></Section>
      </section>}

      {(summary.visibility.appointments || summary.visibility.inventory) && <section className={`grid gap-6 ${summary.visibility.appointments && summary.visibility.inventory ? "xl:grid-cols-3" : ""}`}>
        {summary.visibility.appointments && <Section title="Upcoming appointments" description="Next confirmed/scheduled slots" className={summary.visibility.inventory ? "xl:col-span-2" : undefined}><div className="overflow-x-auto">
            <table className="min-w-[32rem] w-full text-sm">
              <thead className="text-xs uppercase text-muted-foreground">
                <tr className="border-b">
                  <th className="py-3 text-left">Date</th>
                  <th className="py-3 text-left">Time</th>
                  <th className="py-3 text-left">Customer</th>
                  <th className="py-3 text-left">Service</th>
                  <th className="py-3 text-left">Staff</th>
                  <th className="py-3 text-right">Value</th>
                </tr>
              </thead>
              <tbody>
                {(summary?.upcomingAppointments ?? []).length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-5 text-center text-muted-foreground">No upcoming appointments.</td>
                  </tr>
                ) : (
                  (summary?.upcomingAppointments ?? []).map((row) => (
                    <tr key={row.id} className="border-b last:border-0">
                      <td className="py-3 text-muted-foreground">{formatUpcomingDate(row.startAt)}</td>
                      <td className="py-3 text-muted-foreground">{formatUpcomingTime(row.startAt)}</td>
                      <td className="py-3 font-medium">{row.customerName}</td>
                      <td className="py-3 text-muted-foreground">{row.serviceName}</td>
                      <td className="py-3 text-muted-foreground">{row.staffName}</td>
                      <td className="py-3 text-right font-semibold">{formatCurrencyFromCents(row.priceCents, settings)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div></Section>}

        {summary.visibility.inventory && <Section title="Low stock alerts" description="Products at or below reorder point"><div className="space-y-3">
            {(summary?.lowStock ?? []).length === 0 ? (
              <div className="text-sm text-muted-foreground">No low stock items.</div>
            ) : (
              (summary?.lowStock ?? []).map((item) => (
                <div key={item.id} className="rounded-xl border bg-muted/20 px-3 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-medium">{item.name}</span>
                    <span className="text-xs text-muted-foreground">{item.sku}</span>
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">{item.categoryName}</div>
                  <div className="mt-2 text-xs">
                    On hand <span className="font-semibold text-foreground">{item.onHandQty}</span> / Reorder point{" "}
                    <span className="font-semibold text-foreground">{item.reorderPoint}</span>
                  </div>
                </div>
              ))
            )}
          </div></Section>}
      </section>}

      {summary.visibility.appointments && summary.visibility.services && <Section title="Top services" description="Revenue leaders in selected range"><div className="overflow-x-auto">
          <table className="min-w-[32rem] w-full text-sm">
            <thead className="text-xs uppercase text-muted-foreground">
              <tr className="border-b">
                <th className="py-3 text-left">Service</th>
                <th className="py-3 text-right">Bookings</th>
                <th className="py-3 text-right">Revenue</th>
              </tr>
            </thead>
            <tbody>
              {(summary?.topServices ?? []).length === 0 ? (
                <tr>
                  <td colSpan={3} className="py-5 text-center text-muted-foreground">No service sales in selected range.</td>
                </tr>
              ) : (
                (summary?.topServices ?? []).map((row) => (
                  <tr key={row.serviceId} className="border-b last:border-0">
                    <td className="py-3 font-medium">{row.name}</td>
                    <td className="py-3 text-right">{row.bookings}</td>
                    <td className="py-3 text-right font-semibold">{formatCurrencyFromCents(row.revenueCents, settings)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div></Section>}
      </>}
    </div>
  )
}
