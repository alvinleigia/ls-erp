export const dashboardKinds = ["enquiries", "converted", "pipeline", "won", "lost", "openActivities", "overdueActivities", "completedActivities", "completedCalls", "quotations", "planDocuments", "upcomingInstalments", "undatedInstalments"] as const
export type DashboardKind = typeof dashboardKinds[number]
export type DashboardCount = { label: string; count: number }
export type DashboardValue = { currency: string; count: number; amount: string }
export type DashboardPeriod = { start: Date; end: Date; now: Date; today: string }

export type OperationalDashboardPeriod = {
  rangeStart: Date; rangeEndExclusive: Date; todayStart: Date; tomorrowStart: Date;
  periodStartDateOnly: Date; periodEndDateOnly: Date; todayDateOnly: Date; now: Date;
}
