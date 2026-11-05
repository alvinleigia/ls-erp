import { z } from "zod"
import { BusinessError } from "../policy"
import type { DocumentBlock } from "./contracts"

const key = z.string().regex(/^[a-z][a-z0-9.-]{0,70}$/)
const marks = z.array(z.object({ type: z.enum(["bold", "italic", "underline"]) }).strict()).max(3)
const inline = z.discriminatedUnion("type", [
  z.object({ type: z.literal("text"), text: z.string().min(1).max(24000), marks: marks.optional() }).strict(),
  z.object({ type: z.literal("documentField"), attrs: z.object({ key }).strict(), marks: marks.optional() }).strict(),
  z.object({ type: z.literal("hardBreak") }).strict(),
])
const alignment = z.enum(["left", "center", "right"]).nullable().optional()
const node = z.discriminatedUnion("type", [
  z.object({ type: z.literal("paragraph"), attrs: z.object({ textAlign: alignment }).strict().optional(), content: z.array(inline).max(250).optional() }).strict(),
  z.object({ type: z.literal("heading"), attrs: z.object({ level: z.union([z.literal(1), z.literal(2), z.literal(3)]), textAlign: alignment }).strict(), content: z.array(inline).max(250).optional() }).strict(),
  z.object({ type: z.literal("documentSection"), attrs: z.object({ key, compact: z.boolean().optional() }).strict() }).strict(),
  z.object({ type: z.literal("documentPageBreak") }).strict(),
  z.object({ type: z.literal("horizontalRule") }).strict(),
])
export const documentLayoutSchema = z.object({ type: z.literal("doc"), content: z.array(node).min(1).max(120) }).strict().superRefine((value, ctx) => {
  if (JSON.stringify(value).length > 60000) ctx.addIssue({ code: "custom", message: "Keep the layout under 60,000 characters." })
})
export type DocumentLayout = z.infer<typeof documentLayoutSchema>
export type TemplateField = { key: string; label: string; group?: string; help?: string }
export type TemplateCatalog = { fields: TemplateField[]; sections: { key: string; label: string; required: boolean; alternativeFields?: string[] }[]; starter?: DocumentLayout }
export type DocumentRun = { text: string; bold?: boolean; italic?: boolean; underline?: boolean }
export type DocumentFlow = ({ type: "paragraph" | "heading"; level?: number; align: "left" | "center" | "right"; runs: DocumentRun[] } | { type: "section"; blocks: DocumentBlock[]; compact?: boolean } | { type: "pageBreak" } | { type: "rule" })[]

// JSON object key order is not an edit. Keep array order and actual values.
export const documentValueKey = (value: unknown) => JSON.stringify(value, (_key, item) => item && typeof item === "object" && !Array.isArray(item) ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item)

// Open old wording tokens as ordinary editable text, retaining their marks,
// alignment and newlines. This is an unsaved editing view, never a stored rewrite.
export function inlineDocumentWording(layout: DocumentLayout, wording: { opening: string; terms: string }): DocumentLayout {
  const values: Record<string, string> = { "template.opening": wording.opening, "template.terms": wording.terms }
  const copy = structuredClone(layout)
  for (const node of copy.content) if (node.type === "paragraph" || node.type === "heading") {
    node.attrs = { ...node.attrs, textAlign: node.attrs?.textAlign ?? null }
    node.content = node.content?.flatMap(item => item.type === "documentField" && Object.hasOwn(values, item.attrs.key)
      ? values[item.attrs.key] ? [{ type: "text" as const, text: values[item.attrs.key], ...(item.marks ? { marks: item.marks } : {}) }] : []
      : [item])
    if (!node.content?.length) delete node.content
  } else if (node.type === "documentSection") {
    node.attrs = { ...node.attrs, compact: node.attrs.compact ?? false }
  }
  return copy
}

// Only registered fields/sections can enter the stored layout. This is data,
// never HTML, a property-path evaluator, a formula or an executable template.
export function validateDocumentLayout(value: unknown, catalog: TemplateCatalog): DocumentLayout {
  const layout = documentLayoutSchema.parse(value), fields = new Set(catalog.fields.map(row => row.key)), sections = new Set(catalog.sections.map(row => row.key)), seen = new Set<string>(), usedFields = new Set<string>()
  for (const node of layout.content) {
    if (node.type === "documentSection") {
      if (!sections.has(node.attrs.key) || seen.has(node.attrs.key)) throw new BusinessError(400, "Choose each registered document section only once.")
      seen.add(node.attrs.key)
    } else if (node.type === "paragraph" || node.type === "heading") {
      for (const item of node.content ?? []) if (item.type === "documentField") {
        if (!fields.has(item.attrs.key)) throw new BusinessError(400, "This layout contains an unavailable document field.")
        usedFields.add(item.attrs.key)
      }
    }
  }
  const missing = catalog.sections.filter(row => row.required && !seen.has(row.key) && !(row.alternativeFields?.length && row.alternativeFields.every(key => fields.has(key) && usedFields.has(key))))
  if (missing.length) throw new BusinessError(400, `Restore required sections: ${missing.map(row => row.label + (row.alternativeFields?.length ? " (or insert every individual field listed in the field panel)" : "")).join(", ")}.`)
  return layout
}
export function starterDocumentLayout(catalog: TemplateCatalog): DocumentLayout {
  if(catalog.starter)return structuredClone(validateDocumentLayout(catalog.starter,catalog))
  const field = (key: string) => ({ type: "paragraph" as const, content: [{ type: "documentField" as const, attrs: { key } }] })
  return { type: "doc", content: [field("template.opening"), ...catalog.sections.map(row => ({ type: "documentSection" as const, attrs: { key: row.key } })), { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Terms and notes" }] }, field("template.terms")] }
}
export function resolveDocumentLayout(value: unknown, catalog: TemplateCatalog, values: Record<string, string>, blocks: DocumentBlock[]): DocumentFlow {
  const layout = validateDocumentLayout(value, catalog)
  if (blocks.some(block => !block.key || !catalog.sections.some(section => section.key === block.key))) throw new Error("Unregistered document section")
  return layout.content.map(node => {
    if (node.type === "documentPageBreak") return { type: "pageBreak" }
    if (node.type === "horizontalRule") return { type: "rule" }
    if (node.type === "documentSection") return { type: "section", blocks: blocks.filter(block => block.key === node.attrs.key), ...(node.attrs.compact ? { compact: true } : {}) }
    return { type: node.type, ...(node.type === "heading" ? { level: node.attrs.level } : {}), align: node.attrs?.textAlign ?? "left", runs: (node.content ?? []).map(item => {
      if (item.type === "hardBreak") return { text: "\n" }
      if (item.type === "documentField") {
        if (!Object.hasOwn(values, item.attrs.key)) {
          const field = catalog.fields.find(field => field.key === item.attrs.key)!
          throw new BusinessError(409, `The selected field "${field.label}" has no unambiguous accepted value. ${field.help ?? "Review the source before issuing."}`)
        }
        return { text: values[item.attrs.key], bold: item.marks?.some(mark=>mark.type==="bold"), italic: item.marks?.some(mark=>mark.type==="italic"), ...(item.marks?.some(mark=>mark.type==="underline") ? { underline: true } : {}) }
      }
      return { text: item.text, bold: item.marks?.some(mark => mark.type === "bold"), italic: item.marks?.some(mark => mark.type === "italic"), ...(item.marks?.some(mark=>mark.type==="underline") ? { underline: true } : {}) }
    }) }
  })
}
