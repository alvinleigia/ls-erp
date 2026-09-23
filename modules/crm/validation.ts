import { z } from "zod"

const id = z.string().trim().min(1).max(100)
const text = (max: number) => z.string().trim().max(max).default("")
export const enquiryStatuses = ["NEW", "CONTACTED", "QUALIFIED", "CLOSED"] as const

export const crmContactSchema = z.object({
  name: z.string().trim().min(1, "Enter a name.").max(160),
  email: z.string().trim().max(254).pipe(z.union([z.email(), z.literal("")])).default("").transform(value => value.toLowerCase()),
  phone: text(40).transform(value => value.replace(/[\s().-]/g, "")).refine(
    value => !value || /^\+[1-9]\d{6,14}$/.test(value),
    "Use an international number, for example +919876543210.",
  ),
}).strict()
export const crmContactUpdateSchema = crmContactSchema.extend({ version: z.number().int().positive(), archived: z.boolean() })
export const crmEnquiryCreateSchema = z.object({
  contactId: id,
  title: z.string().trim().min(1).max(200),
  source: text(100),
  requirements: text(5000),
  assignedUserId: id,
}).strict()
export const crmEnquiryUpdateSchema = crmEnquiryCreateSchema.omit({ contactId: true }).extend({
  version: z.number().int().positive(),
  status: z.enum(enquiryStatuses),
  outcome: text(2000),
}).refine(value => value.status !== "CLOSED" || value.outcome.length > 0, {
  path: ["outcome"], message: "Record an outcome before closing the enquiry.",
})
export const crmTaskSchema = z.object({
  title: z.string().trim().min(1).max(200),
  dueOn: z.iso.date(),
}).strict()
export const crmNoteSchema = z.object({ message: z.string().trim().min(1).max(5000) }).strict()
export const crmTaskCompleteSchema = z.object({ completed: z.literal(true) }).strict()
export const crmListSchema = z.object({
  page: z.coerce.number().int().min(1).max(100000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  q: text(200),
  status: z.enum(enquiryStatuses).optional(),
  archived: z.enum(["true", "false"]).default("false"),
  due: z.enum(["open", "overdue", "completed"]).optional(),
  sort: z.enum(["createdAt", "updatedAt", "name", "title", "dueOn"]).default("updatedAt"),
  order: z.enum(["asc", "desc"]).default("desc"),
})
export type CrmContactInput = z.infer<typeof crmContactSchema>
export type CrmEnquiryInput = z.infer<typeof crmEnquiryCreateSchema>
export type CrmListInput = z.infer<typeof crmListSchema>
