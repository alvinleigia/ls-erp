import { z } from "zod"

export const lifecycleOptions = ["PLANNING", "PRE_LAUNCH", "SELLING", "ON_HOLD", "CLOSED"] as const
export const categoryOptions = ["APARTMENT", "VILLA", "PLOT", "OFFICE", "RETAIL", "INDUSTRIAL", "MIXED_USE", "OTHER"] as const
const text = (max: number) => z.string().trim().max(max).default("")
const money = z.string().trim().regex(/^(?:\d{1,14}(?:\.\d{1,4})?)?$/, "Enter a non-negative amount with up to four decimal places.").default("")
export const projectSchema = z.object({
  name: z.string().trim().min(1).max(160), code: z.string().trim().toUpperCase().regex(/^[A-Z0-9][A-Z0-9_-]{0,39}$/, "Use up to 40 letters, numbers, hyphens or underscores."),
  parentId: text(100), developerAccountId: text(100), location: text(300), description: text(5000),
  categories: z.array(z.enum(categoryOptions)).max(categoryOptions.length).default([]),
  lifecycle: z.enum(lifecycleOptions).default("PLANNING"), priceMin: money, priceMax: money,
  currency: z.string().trim().toUpperCase().regex(/^(?:[A-Z]{3})?$/, "Use a three-letter currency code.").default(""),
  archived: z.boolean().default(false),
}).strict()
export const projectUpdateSchema = projectSchema.extend({ version: z.number().int().positive() })
export const memberSchema = z.object({ userId: z.string().min(1).max(100), version: z.number().int().positive(), remove: z.boolean().default(false) }).strict()
export const projectListSchema = z.object({
  page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(20),
  q: text(160), archived: z.enum(["false", "true"]).default("false"), parentId: text(100),
  lifecycle: z.enum(["", ...lifecycleOptions]).default(""),
})
