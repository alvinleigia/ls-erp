import { z } from "zod"

export const letterheadProfileSchema = z.object({ topMm: z.number().min(20).max(80), bottomMm: z.number().min(15).max(50) }).strict()
// Absent: inherit company settings. Explicit false disables print copies for
// this template; true supplies its own bounded page reservations.
export const documentLetterheadSchema = z.discriminatedUnion("enabled", [
  letterheadProfileSchema.extend({ enabled: z.literal(true) }).strict(),
  z.object({ enabled: z.literal(false) }).strict(),
])
export type DocumentLetterhead = z.infer<typeof documentLetterheadSchema>
export type CompanyLetterhead = z.infer<typeof letterheadProfileSchema> & { enabled: boolean }
export const documentVariantSchema = z.enum(["digital", "letterhead"])
export type DocumentVariant = z.infer<typeof documentVariantSchema>
export const archivedLetterheadAvailable = (archive: unknown) => !!archive && typeof archive === "object" && "letterhead" in archive && archive.letterhead === true
