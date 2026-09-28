import type { enquiryStatuses } from "@/modules/crm/validation"
import type { PropertyContext } from "./real-estate"
export type CrmStatus = typeof enquiryStatuses[number]
export type CrmContactRow = {
  id: string; name: string; email: string | null; phone: string | null;
  archived: boolean; version: number; canEdit?: boolean;
  alternatePhone?: string | null; whatsappPhone?: string | null;
  addressLine1?: string | null; addressLine2?: string | null; city?: string | null;
  region?: string | null; postalCode?: string | null; country?: string | null;
}
export type CrmAccountRow = CrmContactRow & { website: string | null; notes: string | null }
export type CrmEnquiryRow = {
  propertyContext?: PropertyContext | null; realEstateEnabled?: boolean;
  id: string; title: string; source: string | null; requirements: string | null;
  status: CrmStatus; outcome: string | null; version: number; assignedUserId: string;
  contact: CrmContactRow; assignee: { id: string; name: string | null }; canAssign?: boolean;
  opportunity?: { id: string } | null;
  sourceId?: string | null; accountId?: string | null; targetCloseOn?: string | null;
  referralContactId?: string | null; referralAccountId?: string | null; referralRestricted?: boolean;
  account?: { id: string; name: string } | null;
  referralContact?: { id: string; name: string } | null; referralAccount?: { id: string; name: string } | null;
  leadSource?: { id: string; name: string; archived: boolean } | null;
  createdAt?: string; updatedAt?: string;
  metadata?: Record<"created" | "updated" | "assigned", { createdAt: string; actor: { id: string; name: string | null } } | null>;
}
export type CrmTaskRow = {
  id: string; title: string; dueOn: string; completedAt: string | null;
  enquiry: { id: string; title: string };
}
export type CrmActivityRow = { id: string; event: string; message: string; createdAt: string; actor: { name: string | null } }
export type CrmStageRow = { id: string; name: string; kind: "OPEN" | "WON" | "LOST"; color: string; probability: number; archived: boolean; position: number }
export type CrmPipelineRow = { id: string; name: string; archived: boolean; version: number; stages: CrmStageRow[]; canManage?: boolean }
export type CrmOpportunityRow = {
  propertyContext?: PropertyContext | null; realEstateEnabled?: boolean;
  id: string; title: string; pipelineId: string; stageId: string; contactId: string; accountId: string | null; enquiryId: string | null;
  assignedUserId: string; amount: string; currency: string; probability: number; expectedCloseOn: string; closedAt: string | null;
  lossReason: string | null; description: string | null; version: number;
  overdueActivityCount?: number;
  source?: string | null; referralRestricted?: boolean;
  referralContact?: { id: string; name: string } | null; referralAccount?: { id: string; name: string } | null;
  pipeline: CrmPipelineRow; stage: CrmStageRow; contact: { id: string; name: string }; account: { id: string; name: string } | null;
  assignee: { id: string; name: string | null };
}
