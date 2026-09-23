import type { enquiryStatuses } from "@/modules/crm/validation"
export type CrmStatus = typeof enquiryStatuses[number]
export type CrmContactRow = {
  id: string; name: string; email: string | null; phone: string | null;
  archived: boolean; version: number; canEdit?: boolean;
}
export type CrmAccountRow = CrmContactRow & { website: string | null; notes: string | null }
export type CrmEnquiryRow = {
  id: string; title: string; source: string | null; requirements: string | null;
  status: CrmStatus; outcome: string | null; version: number; assignedUserId: string;
  contact: CrmContactRow; assignee: { id: string; name: string | null }; canAssign?: boolean;
  opportunity?: { id: string } | null;
}
export type CrmTaskRow = {
  id: string; title: string; dueOn: string; completedAt: string | null;
  enquiry: { id: string; title: string };
}
export type CrmActivityRow = { id: string; event: string; message: string; createdAt: string; actor: { name: string | null } }
export type CrmStageRow = { id: string; name: string; kind: "OPEN" | "WON" | "LOST"; color: string; probability: number; archived: boolean; position: number }
export type CrmPipelineRow = { id: string; name: string; archived: boolean; version: number; stages: CrmStageRow[]; canManage?: boolean }
export type CrmOpportunityRow = {
  id: string; title: string; pipelineId: string; stageId: string; contactId: string; accountId: string | null; enquiryId: string | null;
  assignedUserId: string; amount: string; currency: string; probability: number; expectedCloseOn: string; closedAt: string | null;
  lossReason: string | null; description: string | null; version: number;
  overdueActivityCount?: number;
  pipeline: CrmPipelineRow; stage: CrmStageRow; contact: { id: string; name: string }; account: { id: string; name: string } | null;
  assignee: { id: string; name: string | null };
}
