import { z } from "zod"
import { correspondenceSchema } from "@/platform/participants/information"

export const addressPurposes = ["CORRESPONDENCE", "BILLING", "DELIVERY"] as const
export const addressPurposeSchema = z.enum(addressPurposes)
export type AddressPurpose = z.infer<typeof addressPurposeSchema>
export const addressPurposeLabels: Record<AddressPurpose, string> = { CORRESPONDENCE: "Correspondence", BILLING: "Billing", DELIVERY: "Delivery / site" }
export const addressOwnerSchema = z.object({ kind: z.enum(["PERSON", "BUSINESS"]), id: z.string().trim().min(1).max(100) }).strict()
export type AddressOwner = z.infer<typeof addressOwnerSchema>
export const addressReferenceSchema = z.object({ id: z.string().min(1).max(100), version: z.number().int().positive() }).strict()
export const addressReferencesSchema = z.object({ correspondence: addressReferenceSchema.optional(), billing: addressReferenceSchema.optional(), delivery: addressReferenceSchema.optional() }).strict()
export const transactionAddressesSchema = z.object({ billing: correspondenceSchema.optional(), delivery: correspondenceSchema.optional() }).strict()
export const addressFieldsSchema = z.object({
  name: z.string().trim().min(1, "Enter an address name.").max(100),
  purposes: z.array(addressPurposeSchema).min(1).max(3).refine(rows => new Set(rows).size === rows.length, "Choose each purpose once."),
  values: correspondenceSchema,
  defaultCorrespondence: z.boolean().default(false), defaultBilling: z.boolean().default(false), defaultDelivery: z.boolean().default(false), archived: z.boolean().default(false),
}).strict().superRefine((row, ctx) => {
  for (const [flag, purpose] of [["defaultCorrespondence", "CORRESPONDENCE"], ["defaultBilling", "BILLING"], ["defaultDelivery", "DELIVERY"]] as const) {
    if (row[flag] && (row.archived || !row.purposes.includes(purpose))) ctx.addIssue({ code: "custom", path: [flag], message: "A default must be active and support this purpose." })
  }
  if (!row.values.addressLine1 || !row.values.country) ctx.addIssue({ code: "custom", path: ["values"], message: "Enter address line 1 and choose a country." })
})
export const addressCreateSchema = addressFieldsSchema.refine(row => !row.archived, "Create an active address.")
export const addressUpdateSchema = addressFieldsSchema.safeExtend({ version: z.number().int().positive() })
export const addressQuerySchema = z.object({ q: z.string().trim().max(100).default(""), page: z.coerce.number().int().min(1).max(100000).default(1), pageSize: z.coerce.number().int().min(1).max(50).default(20), status: z.enum(["active", "archived", "all"]).default("active"), purpose: addressPurposeSchema.optional() }).strict()
export type AddressFields = z.infer<typeof addressFieldsSchema>
export type AddressRow = AddressFields & { id: string; version: number }
