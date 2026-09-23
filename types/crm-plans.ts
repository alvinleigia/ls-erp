import type { PlanStep } from "@/modules/crm/plan-validation"
export type ActivityPlanRow = { id: string; name: string; description: string | null; steps: PlanStep[]; archived: boolean; version: number; canManage?: boolean }
