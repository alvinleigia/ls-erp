import { z } from "zod"
import { crmListSchema } from "./validation"

export const lostReasonSchema = z.object({ name: z.string().trim().min(1).max(100).transform(value => value.replace(/\s+/g, " ")) }).strict()
export const lostReasonUpdateSchema = lostReasonSchema.extend({ archived: z.boolean(), version: z.number().int().positive() })
export const lostReasonListSchema = crmListSchema.extend({ includeArchived: z.enum(["true", "false"]).default("false") })
