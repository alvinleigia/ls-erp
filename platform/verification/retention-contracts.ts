import { z } from "zod"
export const retentionInputSchema = z.object({ version: z.number().int().min(0).max(2147483646), retainDays: z.number().int().min(1).max(36500).nullable() }).strict()
export const retentionPublishSchema = retentionInputSchema.extend({ previewHash: z.string().regex(/^[a-f0-9]{64}$/) })
export const verificationHoldSchema = z.object({ caseId: z.string().min(1).max(100), version: z.number().int().min(0).max(2147483646), action: z.enum(["PLACE", "RELEASE"]), reason: z.string().trim().min(5).max(1000) }).strict()
export const retentionDecisionLabels = { HOLD: "Retained: preservation hold", TRANSACTION_REFERENCE: "Retained: transaction reference", SUBMISSION_REFERENCE: "Retained: saved submission", INDEFINITE: "Retained indefinitely", PERIOD: "Retention period running", REVIEW: "Eligible for disposal review" } as const
export type RetentionDecision = { decision: keyof typeof retentionDecisionLabels; retainUntil: string | null; evaluatedAt: string; policyVersion: number }
