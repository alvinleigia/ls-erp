export type DashboardCount = { label: string; count: number }
export type DashboardValue = { currency: string; count: number; amount: string }
export type SalesDashboard = {
  enquiries: null | { total: number; converted: number | null; conversionPercent: number | null; statuses: DashboardCount[] }
  opportunities: null | { open: number; won: number; lost: number; winPercent: number | null; stages: DashboardCount[]; values: DashboardValue[] }
  activities: null | { calls: number; connected: number; overdue: number; completed: number; types: DashboardCount[]; upcoming: { id: string; title: string; type: string; dueOn: string; startsAt: string | null }[] }
  projects: null | { active: number; subprojects: number; items: { id: string; name: string; enquiries: number | null; opportunities: number | null }[] }
  quotations: null | { total: number; values: DashboardValue[]; recent: { id: string; title: string; currency: string; amount: string; version: number; createdAt: string }[] }
  paymentPlans: null | { documents: number; undated: number; upcomingCount: number; values: DashboardValue[]; upcoming: { id: string; title: string; label: string; dueDate: string; currency: string; amount: string }[] }
}
