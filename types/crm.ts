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
}
export type CrmTaskRow = {
  id: string; title: string; dueOn: string; completedAt: string | null;
  enquiry: { id: string; title: string };
}
export type CrmActivityRow = { id: string; event: string; message: string; createdAt: string; actor: { name: string | null } }
