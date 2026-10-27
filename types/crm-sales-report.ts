export type SalesReportView = "leads" | "converted" | "pipeline" | "won" | "lost" | "overdue" | "gaps"
export type SalesReportDimension = string
export type SalesReportLabel = { key: string; label: string; terminologyKey?: string }
export type SalesReportGrouping = SalesReportLabel & { emptyLabel: string }
export type SalesReportRecord = {
  id: string; title: string; recordKind: "enquiries" | "opportunities" | "activities";
  customer: string; owner: string; source: string | null; extensionValues: Record<string, string | null>;
  partnerName: string | null; partnerCode: string | null; introductionSupervisorName: string | null;
  lostReasonName: string | null;
  status: string; amount: string | null; currency: string | null; createdAt: string; closedAt: string | null; dueOn: string | null;
}
export type SalesReportSummary = {
  from: string; through: string; today: string; timeZone: string; canManage: boolean; extensionColumns: SalesReportLabel[]; dimensions: SalesReportGrouping[];
  generatedAt: string; totals: Record<SalesReportView, number>; conversionPercent: number;
}
export type SalesLeadGroup = { id: string; label: string; leads: number; converted: number }
export type SalesValueGroup = { stageId: string; stage: string; pipeline: string; currency: string; count: number; amount: string }
