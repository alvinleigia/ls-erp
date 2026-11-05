import { z } from "zod"

export const letterheadProfileSchema = z.object({ topMm: z.number().min(20).max(80), bottomMm: z.number().min(15).max(50) }).strict()
export const documentVariantSchema = z.enum(["digital", "letterhead"])
export type DocumentVariant = z.infer<typeof documentVariantSchema>
export const archivedLetterheadAvailable = (archive: unknown) => !!archive && typeof archive === "object" && "letterhead" in archive && archive.letterhead === true
