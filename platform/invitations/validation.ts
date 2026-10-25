import { z } from "zod"
import { recordRulesSchema, defaultRecordRules } from "@/platform/access/rules"
import { initialOfficeMembershipSchema } from "@/platform/companies/membership-validation"

const fields = {
  accessRoleIds: z.array(z.string().trim().min(1).max(100)).max(50).default([]),
  recordRules: recordRulesSchema.default(defaultRecordRules),
  officeAccess: initialOfficeMembershipSchema.optional(),
}
export const invitationAccessSchema = z.object(fields).strict()
export const inviteUserSchema = z.object({
  email: z.string().trim().email().transform(value => value.toLowerCase()),
  role: z.enum(["ADMIN", "MANAGER", "STAFF", "CUSTOMER"]).default("CUSTOMER"),
  delivery: z.enum(["EMAIL", "LINK"]).default("EMAIL"),
  ...fields,
}).strict()
export const acceptInviteSchema = z.object({
  token: z.string().trim().min(10).max(200),
  name: z.string().trim().min(1).max(100).optional().or(z.literal("")),
  password: z.string().trim().min(6).max(100),
}).strict()
