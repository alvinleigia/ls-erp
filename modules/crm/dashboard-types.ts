import type { DashboardCount, DashboardValue } from "@/types/dashboard"

export type CrmDashboard = {
  enquiries: null | { total: number; converted: number | null; conversionPercent: number | null; statuses: DashboardCount[] }
  opportunities: null | { open: number; won: number; lost: number; winPercent: number | null; stages: DashboardCount[]; values: DashboardValue[] }
  activities: null | { calls: number; connected: number; overdue: number; completed: number; types: DashboardCount[]; upcoming: { id: string; title: string; type: string; dueOn: string; startsAt: string | null }[] }
}
