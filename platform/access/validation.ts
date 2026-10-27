import { z } from "zod"
import { recordRulesSchema } from "./rules"
import { allPermissions } from "./catalog"
import { profileModules, validProfilePermissions } from "./profiles"

export const accessRoleSchema = z.object({
  name: z.string().trim().min(2).max(80),
  permissions: z.array(z.enum(allPermissions as [string, ...string[]])).max(allPermissions.length),
  moduleKey: z.enum(profileModules).optional(),
  archived: z.boolean().default(false),
  version: z.number().int().positive().optional(),
}).strict().superRefine((data, ctx) => {
  if (new Set(data.permissions).size !== data.permissions.length) ctx.addIssue({ code: "custom", path: ["permissions"], message: "Duplicate permission." })
  if (data.permissions.some(key => !data.permissions.includes(`${key.split(".")[0]}.read`))) ctx.addIssue({ code: "custom", path: ["permissions"], message: "Read access is required for other actions on an entity." })
  if (data.moduleKey && !validProfilePermissions(data.moduleKey, data.permissions)) ctx.addIssue({ code: "custom", path: ["permissions"], message: "Choose permissions within this profile's module." })
})
export const roleAssignmentSchema = z.object({
  roleIds: z.array(z.string().min(1).max(100)).max(50), version: z.number().int().min(0),
  rules: recordRulesSchema,
}).strict().refine(data => new Set(data.roleIds).size === data.roleIds.length, { path: ["roleIds"], message: "Select each profile once." })
export const accessListSchema = z.object({
  audience: z.enum(["all", "external"]).default("all"),
  q: z.string().trim().max(120).default(""), page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20), archived: z.enum(["true", "false"]).default("false"),
})
