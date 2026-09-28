import { z } from "zod"
import { COUNTRY_OPTIONS } from "@/lib/constants/countries"
import { propertyContextSchema } from "@/modules/real-estate/sales-validation"

const id = z.string().trim().min(1).max(100)
const text = (max: number) => z.string().trim().max(max).default("")
const optionalText = (max: number) => z.string().trim().max(max).optional()
const phone = z.string().trim().max(40).transform(value => value.replace(/[\s().-]/g, "")).refine(
  value => !value || /^\+[1-9]\d{6,14}$/.test(value), "Use an international number, for example +919876543210.",
)
export const enquiryStatuses = ["NEW", "CONTACTED", "QUALIFIED", "CLOSED"] as const

const identitySchema = z.object({
  name: z.string().trim().min(1, "Enter a name.").max(160),
  email: z.string().trim().max(254).pipe(z.union([z.email(), z.literal("")])).default("").transform(value => value.toLowerCase()),
  phone: phone.default(""),
}).strict()
const optionalPhone = phone.optional()
export const crmContactSchema = identitySchema.extend({
  alternatePhone: optionalPhone, whatsappPhone: optionalPhone,
  addressLine1: optionalText(200), addressLine2: optionalText(200),
  city: optionalText(100), region: optionalText(100), postalCode: optionalText(30),
  country: z.string().trim().refine(value => !value || (COUNTRY_OPTIONS as readonly string[]).includes(value), "Choose a country.").optional(),
})
export const crmContactUpdateSchema = crmContactSchema.extend({ version: z.number().int().positive(), archived: z.boolean() })
export const crmAccountSchema = identitySchema.extend({
  website: text(500).refine(value => {
    if (!value) return true
    try { const url = new URL(value); return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password } catch { return false }
  }, "Enter an http or https website address without credentials."),
  notes: text(5000),
})
export const crmAccountUpdateSchema = crmAccountSchema.extend({ version: z.number().int().positive(), archived: z.boolean() })
export const crmAccountLinkSchema = z.object({ accountId: id }).strict()
const enquiryFields = z.object({
  propertyContext: propertyContextSchema.nullable().optional(),
  title: z.string().trim().min(1).max(200),
  source: optionalText(100),
  sourceId: optionalText(100), accountId: optionalText(100),
  referralContactId: optionalText(100), referralAccountId: optionalText(100),
  targetCloseOn: z.union([z.iso.date(), z.literal("")]).optional(),
  requirements: text(5000),
  assignedUserId: id,
}).strict()
export const crmEnquiryCreateSchema = enquiryFields.extend({ contactId: id.optional(), newContact: crmContactSchema.optional() }).refine(
  value => !!value.contactId !== !!value.newContact, { path: ["contactId"], message: "Choose an existing contact or enter a new contact." },
)
export const crmEnquiryUpdateSchema = enquiryFields.extend({
  version: z.number().int().positive(),
  status: z.enum(enquiryStatuses),
  outcome: text(2000),
  lostReasonId: optionalText(100),
})
export const crmTaskSchema = z.object({
  title: z.string().trim().min(1).max(200),
  dueOn: z.iso.date(),
}).strict()
export const crmNoteSchema = z.object({ message: z.string().trim().min(1).max(5000) }).strict()
export const crmTaskCompleteSchema = z.object({ completed: z.literal(true) }).strict()
export const crmListSchema = z.object({
  projectId: id.optional(), subprojectId: id.optional(),
  page: z.coerce.number().int().min(1).max(100000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  q: text(200),
  status: z.enum(enquiryStatuses).optional(),
  sourceId: id.optional(), assignedUserId: id.optional(), lostReasonId: id.optional(),
  archived: z.enum(["true", "false"]).default("false"),
  activeOnly: z.enum(["true", "false"]).optional(),
  due: z.enum(["open", "overdue", "completed"]).optional(),
  sort: z.enum(["createdAt", "updatedAt", "name", "title", "dueOn"]).default("updatedAt"),
  order: z.enum(["asc", "desc"]).default("desc"),
})
export const crmLeadSourceSchema = z.object({ name: z.string().trim().min(1).max(100).transform(value => value.replace(/\s+/g, " ")) }).strict()
export const crmLeadSourceListSchema = crmListSchema.extend({ includeArchived: z.enum(["true", "false"]).default("false") })
export const crmLeadSourceUpdateSchema = crmLeadSourceSchema.extend({ archived: z.boolean(), version: z.number().int().positive() })
export type CrmContactInput = z.infer<typeof crmContactSchema>
export type CrmAccountInput = z.infer<typeof crmAccountSchema>
export type CrmEnquiryInput = z.infer<typeof crmEnquiryCreateSchema>
export type CrmListInput = z.infer<typeof crmListSchema>
