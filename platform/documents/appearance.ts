import { z } from "zod"
import { letterheadProfileSchema } from "./letterhead"

// Bounded presentation data only. No CSS, URLs, remote fonts or executable templates.
export const documentAppearanceSchema = z.object({
  fontSize: z.number().int().min(9).max(12),
  titleSize: z.number().int().min(12).max(24),
  lineHeight: z.number().min(1).max(3).optional(),
  spaceAfter: z.number().min(0).max(48).optional(),
  spacing: z.enum(["comfortable", "compact"]),
  margins: z.enum(["standard", "narrow", "wide"]),
  colour: z.enum(["navy", "black", "teal"]),
  tableStyle: z.enum(["shaded", "grid", "minimal"]),
  titleAlign: z.enum(["left", "center"]),
  referenceLayout: z.enum(["line", "split"]),
  logoAlign: z.enum(["left", "center", "right"]),
  logoSize: z.enum(["small", "medium", "large"]),
  companyHeading: z.boolean(),
  repeatLogo: z.boolean(),
  watermark: z.boolean(),
  footer: z.string().trim().max(300).refine(text => text.split("\n").length <= 3, "Keep the footer to three text lines."),
  letterhead: letterheadProfileSchema.optional(),
}).strict()
export type DocumentAppearance = z.infer<typeof documentAppearanceSchema>
export const defaultDocumentAppearance: DocumentAppearance = {
  fontSize: 10, titleSize: 20, spacing: "comfortable", margins: "standard",
  colour: "navy", tableStyle: "shaded", titleAlign: "left", referenceLayout: "line", logoAlign: "left",
  logoSize: "medium", companyHeading: true, repeatLogo: false, watermark: false, footer: "",
}
