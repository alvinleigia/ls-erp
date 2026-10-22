import { z } from "zod"
const text = (max: number) => z.string().trim().max(max)
export const catalogItemSchema = z.object({
  code: text(60).min(1).regex(/^[A-Za-z0-9][A-Za-z0-9._/-]*$/, "Use letters, numbers, dots, slashes or hyphens.").transform(s => s.toUpperCase()),
  name: text(200).min(1), description: text(5000).default(""),
  kind: z.enum(["PRODUCT", "UNIT"]), unit: text(40).min(1).default("unit"),
  price: z.string().regex(/^\d{1,12}(\.\d{1,4})?$/, "Enter a non-negative price with up to four decimal places."),
  currency: z.string().regex(/^[A-Z]{3}$/).refine(v => Intl.supportedValuesOf("currency").includes(v), "Choose a currency."),
  availability: z.enum(["AVAILABLE", "UNAVAILABLE", "SOLD"]).default("AVAILABLE"),
  archived: z.boolean().default(false), version: z.number().int().positive().optional(),
  extensionKey: z.string().min(1).max(50).nullable().default(null), extension: z.unknown().optional(),
}).strict().superRefine((v, ctx) => {
  if (v.kind === "PRODUCT" && v.availability === "SOLD") ctx.addIssue({ code: "custom", path: ["availability"], message: "Sold applies to individually identified units." })
  if (!v.extensionKey && v.extension != null) ctx.addIssue({ code: "custom", path: ["extension"], message: "Choose an item extension." })
})
export const catalogListSchema = z.object({
  page: z.coerce.number().int().min(1).max(100000).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(20),
  currency: z.string().regex(/^[A-Z]{3}$/).optional(),
  extensionKey: z.string().min(1).max(50).optional(), contextId: z.string().min(1).max(100).optional(),
  q: text(150).default(""), archived: z.enum(["false", "true"]).default("false"),
  availability: z.enum(["", "AVAILABLE", "UNAVAILABLE", "SOLD", "RESERVED", "ALLOCATED"]).default(""),
}).refine(q => !q.contextId || !!q.extensionKey, "Choose an extension for this context.")
export type CatalogInput = z.infer<typeof catalogItemSchema>
