import type { PlanStep } from "@/modules/crm/plan-validation"
import type { WorkScheduleInput } from "@/modules/crm/work-validation"
import type { WorkType } from "./crm-work"
export type FollowUpRuleRow = { id: string; name: string; sourceType: WorkType; outcome: string; nextStep: PlanStep; maxDepth: number; archived: boolean; version: number; canManage?: boolean }
export type FollowUpPreview = { rule: { id: string; name: string; version: number; maxDepth: number } | null; schedule: (WorkScheduleInput & { activityTypeName?: string | null }) | null; blockedReason: string | null; timeZone?: string }
