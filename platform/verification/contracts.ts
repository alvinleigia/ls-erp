import { z } from "zod"

export const verificationSubjectSchema = z.object({ kind: z.enum(["PERSON", "BUSINESS"]), id: z.string().trim().min(1).max(100) }).strict()
export type VerificationSubject = z.infer<typeof verificationSubjectSchema>
export const verificationRoles = ["CUSTOMER", "ADDITIONAL_CUSTOMER", "REPRESENTATIVE"] as const
const code = z.string().regex(/^[a-z][a-z0-9_]{0,39}$/, "Use a lowercase code starting with a letter.")
const label = z.string().trim().min(1).max(100)
const applicability = {
  subjects: z.array(z.enum(["PERSON", "BUSINESS"])).min(1).max(2).refine(v => new Set(v).size === v.length, "Choose each subject once."),
  roles: z.array(z.enum(verificationRoles)).min(1).max(3).refine(v => new Set(v).size === v.length, "Choose each role once."),
}
export const verificationFactSchema = z.object({
  code, label, type: z.enum(["TEXT", "DATE", "EMAIL", "COUNTRY"]), ...applicability,
}).strict()
export const verificationDocumentSchema = z.object({
  code, label, ...applicability,
}).strict()
export const verificationPolicySchema = z.object({
  format: z.literal(1),
  facts: z.array(verificationFactSchema).max(30),
  documents: z.array(verificationDocumentSchema).max(20),
  validityDays: z.number().int().min(1).max(3650).nullable(),
  // Independent human review is mandatory in the initial release.
  preventSelfApproval: z.literal(true),
}).strict().superRefine((policy, ctx) => {
  for (const key of ["facts", "documents"] as const) {
    if (new Set(policy[key].map(v => v.code)).size !== policy[key].length)
      ctx.addIssue({ code: "custom", path: [key], message: "Use each code once." })
  }
})
export type VerificationPolicy = z.infer<typeof verificationPolicySchema>
export const emptyVerificationPolicy = (): VerificationPolicy => ({ format: 1, facts: [], documents: [], validityDays: null, preventSelfApproval: true })
export const verificationPolicyInputSchema = z.object({ version: z.number().int().min(0).max(2147483646), definition: verificationPolicySchema }).strict()
export const verificationPolicyPublishSchema = verificationPolicyInputSchema.extend({ previewHash: z.string().regex(/^[a-f0-9]{64}$/) })
export type VerificationConfiguration = { version: number; definition: VerificationPolicy }

export function applicableRequirements(policy: VerificationPolicy, subject: VerificationSubject["kind"], role: typeof verificationRoles[number]) {
  const applies = (row: { subjects: ("PERSON" | "BUSINESS")[]; roles: (typeof verificationRoles[number])[] }) => row.subjects.includes(subject) && row.roles.includes(role)
  return { facts: policy.facts.filter(applies), documents: policy.documents.filter(applies) }
}
