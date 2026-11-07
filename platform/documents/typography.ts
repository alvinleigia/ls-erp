import { z } from "zod"

export const headingLevels = [1, 2, 3, 4, 5, 6] as const
export const headingLevelSchema = z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5), z.literal(6)])
export const paragraphSpacingSchema = z.union([z.enum(["compact", "normal", "relaxed"]), z.number().min(0).max(48)]).nullable().optional()
export const lineSpacingSchema = z.union([z.enum(["single", "one-and-half", "double"]), z.number().min(1).max(3)]).nullable().optional()
export type ParagraphSpacing = z.infer<typeof paragraphSpacingSchema>
export type LineSpacing = z.infer<typeof lineSpacingSchema>

// Keep the original H1–H3 sizes; smaller headings use the same body-size scale.
export const headingFontSize = (body: number, level: number) => Math.max(8, body + ({ 1: 7, 2: 3, 3: 1, 4: 0, 5: -1, 6: -2 }[level] ?? 3))
export const paragraphSpaceAfter = (value: ParagraphSpacing) => typeof value === "number" ? value : value ? { compact: 3, normal: 9, relaxed: 15 }[value] : undefined
export const lineHeight = (value: LineSpacing) => typeof value === "number" ? value : value ? { single: 1.2, "one-and-half": 1.5, double: 2 }[value] : undefined
