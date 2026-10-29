import { z } from "zod"
import { BusinessError } from "../policy"
import type { DocumentBlock } from "./contracts"

const key = z.string().regex(/^[a-z][a-z0-9.-]{0,70}$/)
const marks = z.array(z.object({ type: z.enum(["bold", "italic"]) }).strict()).max(2)
const inline = z.discriminatedUnion("type", [
  z.object({ type: z.literal("text"), text: z.string().min(1).max(24000), marks: marks.optional() }).strict(),
  z.object({ type: z.literal("documentField"), attrs: z.object({ key }).strict(), marks: marks.optional() }).strict(),
  z.object({ type: z.literal("hardBreak") }).strict(),
])
const alignment = z.enum(["left", "center", "right"]).nullable().optional()
const node = z.discriminatedUnion("type", [
  z.object({ type: z.literal("paragraph"), attrs: z.object({ textAlign: alignment }).strict().optional(), content: z.array(inline).max(250).optional() }).strict(),
  z.object({ type: z.literal("heading"), attrs: z.object({ level: z.union([z.literal(1), z.literal(2), z.literal(3)]), textAlign: alignment }).strict(), content: z.array(inline).max(250).optional() }).strict(),
  z.object({ type: z.literal("documentSection"), attrs: z.object({ key }).strict() }).strict(),
  z.object({ type: z.literal("documentPageBreak") }).strict(),
])
export const documentLayoutSchema = z.object({ type: z.literal("doc"), content: z.array(node).min(1).max(120) }).strict().superRefine((value, ctx) => {
  if (JSON.stringify(value).length > 60000) ctx.addIssue({ code: "custom", message: "Keep the layout under 60,000 characters." })
})
export type DocumentLayout = z.infer<typeof documentLayoutSchema>
export type TemplateCatalog = { fields: { key: string; label: string }[]; sections: { key: string; label: string; required: boolean }[] }
export type DocumentRun = { text: string; bold?: boolean; italic?: boolean }
export type DocumentFlow = ({ type: "paragraph" | "heading"; level?: number; align: "left" | "center" | "right"; runs: DocumentRun[] } | { type: "section"; blocks: DocumentBlock[] } | { type: "pageBreak" })[]

// Only registered fields/sections can enter the stored layout. This is data,
// never HTML, a property-path evaluator, a formula or an executable template.
export function validateDocumentLayout(value: unknown, catalog: TemplateCatalog): DocumentLayout {
  const layout = documentLayoutSchema.parse(value), fields = new Set(catalog.fields.map(row => row.key)), sections = new Set(catalog.sections.map(row => row.key)), seen = new Set<string>()
  for (const node of layout.content) {
    if (node.type === "documentSection") {
      if (!sections.has(node.attrs.key) || seen.has(node.attrs.key)) throw new BusinessError(400, "Choose each registered document section only once.")
      seen.add(node.attrs.key)
    } else if (node.type !== "documentPageBreak") {
      for (const item of node.content ?? []) if (item.type === "documentField" && !fields.has(item.attrs.key)) throw new BusinessError(400, "This layout contains an unavailable document field.")
    }
  }
  const missing = catalog.sections.filter(row => row.required && !seen.has(row.key))
  if (missing.length) throw new BusinessError(400, `Restore required sections: ${missing.map(row => row.label).join(", ")}.`)
  return layout
}
export function starterDocumentLayout(catalog: TemplateCatalog): DocumentLayout {
  const field = (key: string) => ({ type: "paragraph" as const, content: [{ type: "documentField" as const, attrs: { key } }] })
  return { type: "doc", content: [field("template.opening"), ...catalog.sections.map(row => ({ type: "documentSection" as const, attrs: { key: row.key } })), { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Terms and notes" }] }, field("template.terms")] }
}
export function resolveDocumentLayout(value: unknown, catalog: TemplateCatalog, values: Record<string, string>, blocks: DocumentBlock[]): DocumentFlow {
  const layout = validateDocumentLayout(value, catalog)
  if (blocks.some(block => !block.key || !catalog.sections.some(section => section.key === block.key))) throw new Error("Unregistered document section")
  return layout.content.map(node => {
    if (node.type === "documentPageBreak") return { type: "pageBreak" }
    if (node.type === "documentSection") return { type: "section", blocks: blocks.filter(block => block.key === node.attrs.key) }
    return { type: node.type, ...(node.type === "heading" ? { level: node.attrs.level } : {}), align: node.attrs?.textAlign ?? "left", runs: (node.content ?? []).map(item => {
      if (item.type === "hardBreak") return { text: "\n" }
      if (item.type === "documentField") {
        if (!Object.hasOwn(values, item.attrs.key)) throw new BusinessError(409, "A selected document field has no accepted value. Review the source before issuing.")
        return { text: values[item.attrs.key], bold: item.marks?.some(mark=>mark.type==="bold"), italic: item.marks?.some(mark=>mark.type==="italic") }
      }
      return { text: item.text, bold: item.marks?.some(mark => mark.type === "bold"), italic: item.marks?.some(mark => mark.type === "italic") }
    }) }
  })
}
