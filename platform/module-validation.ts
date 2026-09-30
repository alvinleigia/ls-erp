import { z } from "zod"
import { moduleKeys, moduleAllowanceProblem } from "./modules"

export const tenantModuleSelection = z.array(z.enum(moduleKeys)).max(moduleKeys.length).default([]).superRefine((keys, ctx) => {
  if (new Set(keys).size !== keys.length) ctx.addIssue({ code: "custom", message: "Select each module only once." })
  const flags = keys.map(key => ({ key, allowed: true, enabled: true }))
  for (const key of keys) {
    const problem = moduleAllowanceProblem(flags, key, true)
    if (problem) ctx.addIssue({ code: "custom", message: problem })
  }
})

export const moduleToggleSchema = z.object({ key: z.enum(moduleKeys), enabled: z.boolean() }).strict()
export const moduleAllowanceSchema = z.object({ key: z.enum(moduleKeys), allowed: z.boolean() }).strict()
