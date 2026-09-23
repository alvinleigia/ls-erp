import { z } from "zod"
import { crmListSchema } from "./validation"
export const workTypes = ["TASK", "CALL", "MEETING", "EMAIL"] as const
export const workStatuses = ["OPEN", "IN_PROGRESS", "COMPLETED", "CANCELLED"] as const
export const workOutcomes = {
  TASK: ["DONE"], CALL: ["CONNECTED", "NO_ANSWER", "BUSY", "VOICEMAIL", "WRONG_NUMBER", "NOT_INTERESTED"],
  MEETING: ["HELD", "NO_SHOW"], EMAIL: ["SENT", "REPLIED"],
} as const
const id = z.string().trim().min(1).max(100)
const text = (max: number) => z.string().trim().max(max).default("")
const instant = z.iso.datetime({ offset: true })
const optionalInstant = instant.nullable().default(null)
export const workScheduleSchema = z.object({
  title: z.string().trim().min(1).max(200), type: z.enum(workTypes), assignedUserId: id,
  priority: z.number().int().min(1).max(3).default(2), description: text(5000), dueOn: z.iso.date(),
  startsAt: optionalInstant, endsAt: optionalInstant, reminderAt: optionalInstant,
  callDirection: z.enum(["INBOUND", "OUTBOUND"]).nullable().default(null),
}).strict().superRefine((value, ctx) => {
  if (!!value.startsAt !== !!value.endsAt || (value.startsAt && value.endsAt && (Date.parse(value.endsAt) <= Date.parse(value.startsAt) || Date.parse(value.endsAt) - Date.parse(value.startsAt) > 86400000))) ctx.addIssue({ code: "custom", path: ["endsAt"], message: "Provide both start and end, with a duration above zero and at most 24 hours." })
  if (value.type === "CALL" && !value.callDirection) ctx.addIssue({ code: "custom", path: ["callDirection"], message: "Choose inbound or outbound for a call." })
  if (value.type !== "CALL" && value.callDirection) ctx.addIssue({ code: "custom", path: ["callDirection"], message: "Call direction applies only to calls." })
  if (value.startsAt && value.reminderAt && Date.parse(value.reminderAt) > Date.parse(value.startsAt)) ctx.addIssue({ code: "custom", path: ["reminderAt"], message: "Set the reminder at or before the scheduled start." })
})
const completion = z.object({ summary: z.string().trim().min(1, "Record a summary for the next staff member.").max(5000), outcome: z.string().min(1).max(40), occurredAt: instant, durationMinutes: z.number().int().min(0).max(1440).nullable().default(null) }).strict()
export const workCreateSchema = workScheduleSchema.safeExtend({ contactId: id, enquiryId: text(100), opportunityId: text(100), completion: completion.optional() }).refine(value => !(value.enquiryId && value.opportunityId), { path: ["opportunityId"], message: "Link either an enquiry or an opportunity." })
export const workUpdateSchema = workScheduleSchema.safeExtend({ version: z.number().int().positive(), status: z.enum(["OPEN", "IN_PROGRESS"]) })
export const workCompleteSchema = completion.extend({ version: z.number().int().positive(), followUp: workScheduleSchema.optional() })
export const workCancelSchema = z.object({ version: z.number().int().positive(), reason: z.string().trim().min(1).max(2000) }).strict()
export const workReminderSchema = z.object({ version: z.number().int().positive(), action: z.enum(["SNOOZE", "DISMISS"]), minutes: z.union([z.literal(15), z.literal(60), z.literal(1440)]).optional() }).strict().refine(value => value.action !== "SNOOZE" || !!value.minutes, { path: ["minutes"], message: "Choose a snooze interval." })
export const workListSchema = crmListSchema.omit({ status: true, due: true, archived: true, sort: true }).extend({
  contactId: id.optional(), enquiryId: id.optional(), opportunityId: id.optional(), assignedUserId: id.optional(),
  scope: z.enum(["mine", "visible"]).default("mine"), type: z.enum(workTypes).optional(),
  state: z.enum(["open", "all", "completed", "cancelled"]).default("open"),
  due: z.enum(["overdue", "today", "upcoming", "reminders"]).optional(),
  from: z.iso.date().optional(), to: z.iso.date().optional(), sort: z.enum(["dueOn", "priority", "updatedAt"]).default("dueOn"),
  completedFrom: z.iso.date().optional(), completedThrough: z.iso.date().optional(),
  order: z.enum(["asc", "desc"]).default("asc"),
}).superRefine((value, ctx) => {
  if (!!value.completedFrom !== !!value.completedThrough || (value.completedFrom && value.completedThrough && (value.completedThrough < value.completedFrom || Date.parse(value.completedThrough) - Date.parse(value.completedFrom) > 365 * 86400000))) ctx.addIssue({ code: "custom", path: ["completedThrough"], message: "Choose a completion period of 1–366 days." })
  if (!!value.from !== !!value.to || (value.from && value.to && (value.to <= value.from || Date.parse(value.to) - Date.parse(value.from) > 62 * 86400000))) ctx.addIssue({ code: "custom", path: ["to"], message: "Choose a calendar window of 1–62 days." })
})
export type WorkScheduleInput = z.infer<typeof workScheduleSchema>
export type WorkCreateInput = z.infer<typeof workCreateSchema>
