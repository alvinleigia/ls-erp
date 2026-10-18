export type DashboardCount = { label: string; count: number }
export type DashboardValue = { currency: string; count: number; amount: string }
export type DashboardPeriod = { start: Date; end: Date; now: Date; today: string }

export type OperationalDashboardPeriod = {
  rangeStart: Date; rangeEndExclusive: Date; todayStart: Date; tomorrowStart: Date;
  periodStartDateOnly: Date; periodEndDateOnly: Date; todayDateOnly: Date; now: Date;
}
