import { z } from "zod"
export const disposalPreviewSchema = z.object({ evidenceId: z.string().uuid() }).strict()
export const disposalRequestSchema = disposalPreviewSchema.extend({ requestKey: z.string().uuid(), previewHash: z.string().regex(/^[a-f0-9]{64}$/), reason: z.string().trim().min(5).max(1000), reviewed: z.literal(true) })
export const disposalActionSchema = z.object({ id: z.string().uuid(), version: z.number().int().positive(), action: z.enum(["execute", "reconcile", "cancel"]) }).strict()
export const disposalAvailableEvidence = { disposals: { none: { state: { not: "CANCELLED" } } } } as const
