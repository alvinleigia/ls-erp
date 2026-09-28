import type { WorkType } from "./crm-work"
export type ActivityOverview = {
  from: string; through: string; today: string; timeZone: string; scope: "mine" | "team"; canManage: boolean; generatedAt: string;
  totals: { open: number; overdue: number; dueToday: number; completed: number; withoutActivity: number };
  activityTypeName?: string | null;
  byType: { type: WorkType; open: number; completed: number }[];
  callOutcomes: { outcome: string; count: number }[];
}
export type StaffActivityRow = { id: string; name: string | null; status: string; open: number; overdue: number; dueToday: number; completed: number }
export type FollowUpGapRow = { id: string; title: string; expectedCloseOn: string; contact: { id: string; name: string }; assignee: { id: string; name: string | null }; pipeline: { name: string }; stage: { name: string } }
