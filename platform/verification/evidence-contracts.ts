import { z } from "zod"
export const EVIDENCE_LIMIT = 5 * 1024 * 1024
export const EVIDENCE_CASE_LIMIT = 20
export const evidenceTypes = ["application/pdf", "image/jpeg", "image/png"] as const
export const evidenceUploadSchema = z.object({
  caseId: z.string().min(1).max(100), documentCode: z.string().regex(/^[a-z][a-z0-9_]{0,39}$/),
  filename: z.string().trim().min(1).max(120).refine(v => !/[\x00-\x1f\x7f/\\"]/.test(v), "Use a filename without paths or control characters."),
  contentType: z.enum(evidenceTypes), bytes: z.number().int().min(1).max(EVIDENCE_LIMIT),
}).strict()
export type EvidenceUpload = z.infer<typeof evidenceUploadSchema>
export type EvidenceMetadata = { id: string; documentCode: string; filename: string; contentType: string; bytes: number; createdAt: Date | string; readyAt: Date | string | null; state: string }
