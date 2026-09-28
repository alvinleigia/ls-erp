import { z } from "zod"
import { crmListSchema } from "./validation"
import { workTypes } from "./work-validation"

export const activityTypeSchema = z.object({
  name: z.string().trim().min(1).max(100).transform(value => value.replace(/\s+/g, " ")),
  baseType: z.enum(workTypes),
  defaultInstructions: z.string().trim().max(5000).default(""),
}).strict().refine(value => !workTypes.some(type => type === value.name.toUpperCase()), { path: ["name"], message: "Choose a name different from the built-in activity types." })
export const activityTypeUpdateSchema = activityTypeSchema.safeExtend({ version: z.number().int().positive(), archived: z.boolean() })
export const activityTypeListSchema = crmListSchema.extend({ includeArchived: z.enum(["true", "false"]).optional() })
