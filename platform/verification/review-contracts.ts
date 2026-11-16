import { z } from "zod"
import { verificationSubjectSchema, verificationRoles } from "./contracts"

const page = z.coerce.number().int().min(1).max(100000).default(1)
const pageSize = z.coerce
  .number()
  .pipe(z.union([z.literal(5), z.literal(10), z.literal(20), z.literal(30)]))
  .default(10)
export const verificationHistorySchema = verificationSubjectSchema.extend({ page, pageSize })
export const verificationRevisionSchema = verificationSubjectSchema.extend({
  submissionId: z.string().min(1).max(100)
})
export const verificationQueueSchema = z
  .object({
    page,
    pageSize,
    search: z.string().trim().max(100).default(""),
    kind: z.enum(["PERSON", "BUSINESS"]).optional(),
    role: z.enum(verificationRoles).optional()
  })
  .strict()
export type VerificationQueueQuery = z.infer<typeof verificationQueueSchema>
