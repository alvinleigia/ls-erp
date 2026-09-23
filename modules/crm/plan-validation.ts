import { z } from "zod"
import { workTypes } from "./work-validation"

export const planStepSchema = z.object({
  title: z.string().trim().min(1).max(200), type: z.enum(workTypes),
  dayOffset: z.number().int().min(0).max(365), priority: z.number().int().min(1).max(3).default(2),
  description: z.string().trim().max(5000).default(""),
  callDirection: z.enum(["INBOUND", "OUTBOUND"]).nullable().default(null),
  reminderTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable().default(null),
}).strict().refine(value => value.type === "CALL" ? !!value.callDirection : !value.callDirection, { path: ["callDirection"], message: "Call direction is required only for calls." })
export const activityPlanSchema = z.object({
  name: z.string().trim().min(1).max(150), description: z.string().trim().max(2000).default(""),
  steps: z.array(planStepSchema).min(1).max(12).refine(steps => steps.every((step, index) => !index || step.dayOffset >= steps[index - 1].dayOffset), "Keep steps in date order."),
}).strict()
export const activityPlanUpdateSchema = activityPlanSchema.extend({ version: z.number().int().positive(), archived: z.boolean() })
export const applyPlanSchema = z.object({
  version: z.number().int().positive(), requestKey: z.uuid(), startOn: z.iso.date(),
  contactId: z.string().trim().min(1).max(100), assignedUserId: z.string().trim().min(1).max(100),
  enquiryId: z.string().trim().max(100).default(""), opportunityId: z.string().trim().max(100).default(""),
}).strict().refine(value => !(value.enquiryId && value.opportunityId), { path: ["opportunityId"], message: "Choose either an enquiry or an opportunity." })
export type PlanStep = z.infer<typeof planStepSchema>
