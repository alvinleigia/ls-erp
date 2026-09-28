import type { workTypes, workStatuses } from "@/modules/crm/work-validation"
import type { ListResponse } from "./api"
export type WorkType = typeof workTypes[number]
export type WorkStatus = typeof workStatuses[number]
export type CrmWorkRow = {
  id: string; contactId: string; enquiryId: string | null; opportunityId: string | null; assignedUserId: string;
  activityTypeId?: string | null; activityTypeName?: string | null; title: string; type: WorkType; status: WorkStatus; priority: number; version: number; description: string | null;
  dueOn: string; startsAt: string | null; endsAt: string | null; reminderAt: string | null; snoozedUntil: string | null; reminderDismissedAt: string | null;
  callDirection: "INBOUND" | "OUTBOUND" | null; summary: string | null; outcome: string | null; occurredAt: string | null; durationMinutes: number | null;
  completedAt: string | null; cancellationReason: string | null; canEdit: boolean; timeZone?: string;
  contact: { id: string; name: string; email: string | null; phone: string | null }; assignee: { id: string; name: string | null };
  parent: { id: string; title: string; kind: "enquiry" | "opportunity" } | null;
  planLaunchId: string | null; planPosition: number | null; planLaunch: { planName: string; planVersion: number } | null;
  followUpRuleId: string | null; followUpRuleName: string | null; followUpRuleVersion: number | null; automationDepth: number;
}
export type WorkListResponse = ListResponse<CrmWorkRow> & { timeZone: string; currentUserId: string; canManage: boolean; serverTime: string }
export type InteractionRow = { activityTypeName?: string | null; id: string; type: WorkType; summary: string; outcome: string; occurredAt: string; callDirection: string | null; durationMinutes: number | null; completedBy: { name: string | null } | null }
