import { z } from "zod"
import { categoryOptions } from "./validation"
export const buyingTimeframes = ["ASAP", "WITHIN_3_MONTHS", "3_TO_6_MONTHS", "6_TO_12_MONTHS", "OVER_12_MONTHS", "EXPLORING"] as const
const optionalId = z.string().trim().max(100).default("")
const money = z.string().trim().regex(/^(?:\d{1,14}(?:\.\d{1,4})?)?$/, "Enter a non-negative budget with up to four decimal places.").default("")
export const propertyContextSchema = z.object({
  projectId: optionalId, subprojectId: optionalId, budgetMin: money, budgetMax: money,
  budgetCurrency: z.string().trim().toUpperCase().refine(value => !value || Intl.supportedValuesOf("currency").includes(value), "Choose a supported currency.").default(""),
  propertyCategory: z.enum(["", ...categoryOptions]).default(""),
  bedrooms: z.number().int().min(0).max(50).nullable().default(null),
  buyingTimeframe: z.enum(["", ...buyingTimeframes]).default(""),
}).strict().refine(data => !data.subprojectId || !!data.projectId, { path: ["projectId"], message: "Select a project for this subproject." })
export type PropertyContextInput = z.infer<typeof propertyContextSchema>
