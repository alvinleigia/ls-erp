import { z } from "zod"
import { allPermissions } from "./catalog"

export const accessRoleSchema = z.object({
  name: z.string().trim().min(2).max(80),
  permissions: z.array(z.enum(allPermissions as [string, ...string[]])).max(allPermissions.length),
  archived: z.boolean().default(false),
  version: z.number().int().positive().optional(),
}).strict().superRefine((data, ctx) => {
  if (new Set(data.permissions).size !== data.permissions.length) ctx.addIssue({ code: "custom", path: ["permissions"], message: "Duplicate permission." })
  if (data.permissions.some(key => !data.permissions.includes(`${key.split(".")[0]}.read`))) ctx.addIssue({ code: "custom", path: ["permissions"], message: "Read access is required for other actions on an entity." })
})
export const roleAssignmentSchema = z.object({ roleId: z.string().min(1).nullable(), previousRoleId: z.string().min(1).nullable() }).strict()
export const accessListSchema = z.object({
  q: z.string().trim().max(120).default(""), page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20), archived: z.enum(["true", "false"]).default("false"),
})
