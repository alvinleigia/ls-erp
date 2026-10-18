import type { DashboardValue } from "@/types/dashboard"

export type DocumentDashboard = {
  quotations: null | { total: number; values: DashboardValue[]; recent: { id: string; title: string; currency: string; amount: string; version: number; createdAt: string }[] }
  paymentPlans: null | { documents: number; undated: number; upcomingCount: number; values: DashboardValue[]; upcoming: { id: string; title: string; label: string; dueDate: string; currency: string; amount: string }[] }
}
