import { termText } from "@/platform/terminology/message"
import { z } from "zod"
import { workTypes, workOutcomes } from "./work-validation"
import { planStepSchema } from "./plan-validation"

export const followUpRuleSchema = z.object({
  name: z.string().trim().min(1).max(150), sourceType: z.enum(workTypes), outcome: z.string().min(1).max(40),
  nextStep: planStepSchema, maxDepth: z.number().int().min(1).max(10).default(3),
}).strict().refine(value => (workOutcomes[value.sourceType] as readonly string[]).includes(value.outcome), { path: ["outcome"], message: "Choose an outcome for the triggering activity type.", params: { terminology: termText("crm.activity.singular", "Choose an outcome for the triggering activity type.", "Choose an outcome for the triggering {label} type.") } })
export const followUpRuleUpdateSchema = followUpRuleSchema.safeExtend({ version: z.number().int().positive(), archived: z.boolean() })
