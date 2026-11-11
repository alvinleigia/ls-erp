import { z } from "zod"
import { COUNTRY_OPTIONS } from "@/lib/constants/countries"
import { applicableRequirements, verificationRoles, type VerificationPolicy, type VerificationSubject } from "./contracts"

const version = z.number().int().min(0).max(2147483646)
const id = z.string().min(1).max(100)
export const privateFactSchema = z.object({ code: z.string().regex(/^[a-z][a-z0-9_]{0,39}$/), value: z.string().trim().min(1).max(500) }).strict()
export const verificationSubmissionSchema = z.object({
  caseId: id, version, policyVersion: version.refine(v => v > 0), role: z.enum(verificationRoles),
  facts: z.array(privateFactSchema).max(30), evidenceIds: z.array(id).max(20), reason: z.string().trim().min(1).max(1000).optional(),
}).strict().superRefine((data, ctx) => {
  if (new Set(data.facts.map(f => f.code)).size !== data.facts.length || new Set(data.evidenceIds).size !== data.evidenceIds.length)
    ctx.addIssue({ code: "custom", message: "Select each fact and evidence file once." })
  if (data.version > 0 && !data.reason) ctx.addIssue({ code: "custom", path: ["reason"], message: "Explain why a new revision is needed." })
})
export const verificationReviewSchema = z.object({
  submissionId: id, version, reviewVersion: version, decision: z.enum(["APPROVED", "CHANGES_REQUIRED", "REVOKED"]),
  reason: z.string().trim().min(1).max(1000).optional(), reviewed: z.boolean(),
}).strict().superRefine((data, ctx) => {
  if (data.decision === "APPROVED" && !data.reviewed) ctx.addIssue({ code: "custom", message: "Review the submitted facts and evidence before approval." })
  if (data.decision !== "APPROVED" && !data.reason) ctx.addIssue({ code: "custom", path: ["reason"], message: "Provide a reason for this decision." })
})
export function privateFactsValid(policy: VerificationPolicy, kind: VerificationSubject["kind"], role: typeof verificationRoles[number], facts: z.infer<typeof privateFactSchema>[]) {
  const required = applicableRequirements(policy, kind, role).facts
  if (facts.length !== required.length || new Set(facts.map(f => f.code)).size !== facts.length) return false
  return required.every(field => {
    const value = facts.find(f => f.code === field.code)?.value
    if (!value || value !== value.trim() || value.length > 500) return false
    switch (field.type) {
      case "EMAIL": return value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
      case "COUNTRY": return (COUNTRY_OPTIONS as readonly string[]).includes(value)
      case "DATE": return /^\d{4}-\d{2}-\d{2}$/.test(value) && value.slice(0, 4) !== "0000" && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value
      default: return true
    }
  })
}
