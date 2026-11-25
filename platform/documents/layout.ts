import { z } from "zod"
import { BusinessError } from "../policy"
import type { DocumentBlock } from "./contracts"
import { headingLevelSchema, paragraphSpacingSchema, lineSpacingSchema, textFontSizeSchema, type ParagraphSpacing, type LineSpacing } from "./typography"

const key = z.string().regex(/^[a-z][a-z0-9.-]{0,70}$/)
export const documentLinkSchema = z.string().trim().max(1000).refine(value => {
  if (/\s|[\x00-\x1f\x7f]/.test(value)) return false
  try { const url = new URL(value); return ["http:", "https:", "mailto:"].includes(url.protocol) && (url.protocol === "mailto:" ? !!url.pathname && !url.search && !url.hash : !!url.hostname && !url.username && !url.password) } catch { return false }
}, "Use an https://, http:// or mailto: link without credentials or spaces.")
const marks = z.array(z.union([
  z.object({ type: z.enum(["bold", "italic", "underline", "superscript", "subscript"]) }).strict(),
  z.object({ type: z.literal("link"), attrs: z.object({ href: documentLinkSchema }).strict() }).strict(),
  z.object({ type: z.literal("fontSize"), attrs: z.object({ size: textFontSizeSchema }).strict() }).strict(),
])).max(6).superRefine((value, ctx) => {
  if (new Set(value.map(mark => mark.type)).size !== value.length || value.some(mark => mark.type === "superscript") && value.some(mark => mark.type === "subscript")) ctx.addIssue({ code: "custom", message: "Use each format once and choose superscript or subscript." })
})
const inline = z.discriminatedUnion("type", [
  z.object({ type: z.literal("text"), text: z.string().min(1).max(24000), marks: marks.optional() }).strict(),
  z.object({ type: z.literal("documentField"), attrs: z.object({ key, documentTitle: z.literal(true).nullable().optional() }).strict(), marks: marks.optional() }).strict(),
  z.object({ type: z.literal("hardBreak") }).strict(),
])
const alignment = z.enum(["left", "center", "right"]).nullable().optional()
const spacing = { paragraphSpacing: paragraphSpacingSchema, lineSpacing: lineSpacingSchema }
const paragraph = z.object({ type: z.literal("paragraph"), attrs: z.object({ textAlign: alignment, ...spacing }).strict().optional(), content: z.array(inline).max(250).optional() }).strict()
const heading = z.object({ type: z.literal("heading"), attrs: z.object({ level: headingLevelSchema, textAlign: alignment, ...spacing }).strict(), content: z.array(inline).max(250).optional() }).strict()
type TextNode = z.infer<typeof paragraph> | z.infer<typeof heading>
type ListNode = ({ type: "bulletList" } | { type: "orderedList" }) & { attrs?: { start?: number; type?: "1" | null }; content: { type: "listItem"; content: (z.infer<typeof paragraph> | ListNode)[] }[] }
function listSchema(depth: number): z.ZodType<ListNode> {
  return z.object({ type: z.enum(["bulletList", "orderedList"]), attrs: z.object({ start: z.number().int().min(1).max(9999).optional(), type: z.literal("1").nullable().optional() }).strict().optional(), content: z.array(z.object({ type: z.literal("listItem"), content: z.array(depth > 1 ? z.union([paragraph, listSchema(depth - 1)]) : paragraph).min(1).max(30).refine(nodes => nodes[0]?.type === "paragraph", "Start each list item with a paragraph.") }).strict()).min(1).max(100) }).strict()
}
const block = z.union([
  paragraph, heading, listSchema(3),
  z.object({ type: z.literal("documentSection"), attrs: z.object({ key, compact: z.boolean().optional(), hideTitle: z.boolean().nullable().optional(), boldLabels: z.boolean().nullable().optional(), boldHeader: z.boolean().nullable().optional(), alignEnd: z.number().int().min(0).max(12).nullable().optional() }).strict() }).strict(),
  z.object({ type: z.literal("documentPageBreak") }).strict(),
  z.object({ type: z.literal("horizontalRule") }).strict(),
])
// A row contains one to three equal columns. No nested grids, arbitrary widths
// or positioning: ordinary text and repeated source sections remain the content.
const columns = z.object({ type: z.literal("documentColumns"), content: z.array(z.object({ type: z.literal("documentColumn"), content: z.array(block).min(1).max(120) }).strict()).min(1).max(3) }).strict()
const node = z.union([block, columns])
export const documentLayoutSchema = z.object({ type: z.literal("doc"), content: z.array(node).min(1).max(120) }).strict().superRefine((value, ctx) => {
  if (JSON.stringify(value).length > 60000) ctx.addIssue({ code: "custom", message: "Keep the layout under 60,000 characters." })
  let count = 0
  function countNodes(nodes: z.infer<typeof node>[]) { for (const item of nodes) { count++; if (item.type === "documentColumns") for (const column of item.content) { count++; countNodes(column.content) }; if (item.type === "bulletList" || item.type === "orderedList") for (const li of item.content) { count++; countNodes(li.content) } } }
  countNodes(value.content)
  if (count > 120) ctx.addIssue({ code: "custom", message: "Keep the layout under 120 blocks, including list items." })
})
export type DocumentLayout = z.infer<typeof documentLayoutSchema>
export type TemplateField = { key: string; label: string; group?: string; help?: string }
export type TemplateCatalog = { fields: TemplateField[]; sections: { key: string; label: string; required: boolean; alternativeFields?: string[] }[]; starter?: DocumentLayout }
export const issuerSignatureSection = { key: "issuer-signature", label: "Issuer and signature", required: false }
export type DocumentRun = { text: string; bold?: boolean; italic?: boolean; underline?: boolean; script?: "super" | "sub"; href?: string; fontSize?: number }
export type DocumentFlow = ({ type: "paragraph" | "heading"; level?: number; align: "left" | "center" | "right"; runs: DocumentRun[]; documentTitle?: true; paragraphSpacing?: ParagraphSpacing; lineSpacing?: LineSpacing; indent?: number; marker?: string } | { type: "section"; blocks: DocumentBlock[]; compact?: boolean; hideTitle?: boolean; boldLabels?: boolean; boldHeader?: boolean; alignEnd?: number } | { type: "columns"; columns: DocumentFlow[] } | { type: "issuer" } | { type: "pageBreak" } | { type: "rule" })[]

export function documentLayoutBlocks(nodes: DocumentLayout["content"]): z.infer<typeof block>[] {
  return nodes.flatMap(node => node.type === "documentColumns" ? node.content.flatMap(column => column.content) : [node])
}
export function documentFlowNodes(nodes: DocumentFlow): DocumentFlow {
  return nodes.flatMap(node => node.type === "columns" ? documentFlowNodes(node.columns.flat()) : [node])
}

function textNodes(nodes: DocumentLayout["content"]): TextNode[] {
  return documentLayoutBlocks(nodes).flatMap((node): TextNode[] => node.type === "paragraph" || node.type === "heading" ? [node] : node.type === "bulletList" || node.type === "orderedList" ? node.content.flatMap(item => textNodes(item.content)) : [])
}

// JSON object key order is not an edit. Keep array order and actual values.
export const documentValueKey = (value: unknown) => JSON.stringify(value, (key, item) => ["paragraphSpacing", "lineSpacing", "documentTitle", "hideTitle", "boldLabels", "boldHeader", "alignEnd"].includes(key) && item == null ? undefined : item && typeof item === "object" && !Array.isArray(item) ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item)

// Open old wording tokens as ordinary editable text, retaining their marks,
// alignment and newlines. This is an unsaved editing view, never a stored rewrite.
export function inlineDocumentWording(layout: DocumentLayout, wording: { opening: string; terms: string }): DocumentLayout {
  const values: Record<string, string> = { "template.opening": wording.opening, "template.terms": wording.terms }
  const copy = structuredClone(layout)
  for (const node of textNodes(copy.content)) {
    node.attrs = { ...node.attrs, textAlign: node.attrs?.textAlign ?? null, paragraphSpacing: node.attrs?.paragraphSpacing ?? null, lineSpacing: node.attrs?.lineSpacing ?? null }
    node.content = node.content?.flatMap(item => item.type === "documentField" && Object.hasOwn(values, item.attrs.key)
      ? values[item.attrs.key] ? [{ type: "text" as const, text: values[item.attrs.key], ...(item.marks ? { marks: item.marks } : {}) }] : []
      : [item])
    if (!node.content?.length) delete node.content
  }
  for (const node of documentLayoutBlocks(copy.content)) if (node.type === "documentSection") {
    node.attrs = { ...node.attrs, compact: node.attrs.compact ?? false }
  }
  return copy
}

// Add the title to an unsaved editing view only. Stored layouts and issued files
// are never rewritten. Once present, its position and ordinary heading attributes win.
export function editableDocumentLayout(layout: DocumentLayout, catalog: TemplateCatalog, alignment: "left" | "center" = "left", includeIssuer = false): DocumentLayout {
  const titleKey = catalog.fields.find(field => ["document.title", "quote.title"].includes(field.key))?.key
  const copy = structuredClone(layout)
  if (titleKey) {
    const existing = textNodes(copy.content).flatMap(node => node.content ?? []).find(item => item.type === "documentField" && item.attrs.key === titleKey)
    if (existing?.type === "documentField") existing.attrs.documentTitle = true
    else copy.content.unshift({ type: "heading", attrs: { level: 1, textAlign: alignment, paragraphSpacing: null, lineSpacing: null }, content: [{ type: "documentField", attrs: { key: titleKey, documentTitle: true } }] })
  }
  // An editing view only: old stored templates and archived PDFs remain fixed.
  if (includeIssuer && !documentLayoutBlocks(copy.content).some(node => node.type === "documentSection" && node.attrs.key === issuerSignatureSection.key)) copy.content.push({ type: "documentSection", attrs: { key: issuerSignatureSection.key } })
  return copy
}

// Only registered fields/sections can enter the stored layout. This is data,
// never HTML, a property-path evaluator, a formula or an executable template.
export function validateDocumentLayout(value: unknown, catalog: TemplateCatalog): DocumentLayout {
  const layout = documentLayoutSchema.parse(value), fields = new Set(catalog.fields.map(row => row.key)), sections = new Set(catalog.sections.map(row => row.key)), seen = new Set<string>(), usedFields = new Set<string>()
  if (fields.has("document.title")) sections.add(issuerSignatureSection.key)
  for (const node of documentLayoutBlocks(layout.content)) {
    if (node.type === "documentSection") {
      if (!sections.has(node.attrs.key) || seen.has(node.attrs.key)) throw new BusinessError(400, "Choose each registered document section only once.")
      seen.add(node.attrs.key)
    }
  }
  for (const node of textNodes(layout.content)) {
      for (const item of node.content ?? []) if (item.type === "documentField") {
        if (item.attrs.documentTitle && !["document.title", "quote.title"].includes(item.attrs.key)) throw new BusinessError(400, "Only the document title field can identify the title.")
        if (!fields.has(item.attrs.key)) throw new BusinessError(400, "This layout contains an unavailable document field.")
        usedFields.add(item.attrs.key)
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
  function resolve(nodes: DocumentLayout["content"], depth = 0): DocumentFlow { return nodes.flatMap((node): DocumentFlow => {
    if (node.type === "documentColumns") return [{ type: "columns", columns: node.content.map(column => resolve(column.content)) }]
    if (node.type === "bulletList" || node.type === "orderedList") return node.content.flatMap((item, index) => {
      const rows = resolve(item.content, depth + 1)
      const first = rows[0]
      if (first && "runs" in first) first.marker = node.type === "bulletList" ? "•" : `${(node.attrs?.start ?? 1) + index}.`
      return rows
    })
    if (node.type === "documentPageBreak") return [{ type: "pageBreak" }]
    if (node.type === "horizontalRule") return [{ type: "rule" }]
    if (node.type === "documentSection") return node.attrs.key === issuerSignatureSection.key ? [{ type: "issuer" }] : [{ type: "section", blocks: blocks.filter(block => block.key === node.attrs.key), ...(node.attrs.compact ? { compact: true } : {}), ...(node.attrs.hideTitle ? { hideTitle: true } : {}), ...(node.attrs.boldLabels ? { boldLabels: true } : {}), ...(node.attrs.boldHeader ? { boldHeader: true } : {}), ...(node.attrs.alignEnd ? { alignEnd: node.attrs.alignEnd } : {}) }]
    return [{ type: node.type, ...(node.content?.some(item => item.type === "documentField" && item.attrs.documentTitle && ["document.title", "quote.title"].includes(item.attrs.key)) ? { documentTitle: true as const } : {}), ...(node.type === "heading" ? { level: node.attrs.level } : {}), ...(depth ? { indent: depth } : {}), ...(node.attrs?.paragraphSpacing != null ? { paragraphSpacing: node.attrs.paragraphSpacing } : {}), ...(node.attrs?.lineSpacing != null ? { lineSpacing: node.attrs.lineSpacing } : {}), align: node.attrs?.textAlign ?? "left", runs: (node.content ?? []).map(item => {
      if (item.type === "hardBreak") return { text: "\n" }
      const script = item.marks?.some(mark => mark.type === "superscript") ? "super" as const : item.marks?.some(mark => mark.type === "subscript") ? "sub" as const : undefined
      const link = item.marks?.find(mark => mark.type === "link")
      const fontSize = item.marks?.find(mark => mark.type === "fontSize")
      const extra = { ...(script ? { script } : {}), ...(link?.type === "link" ? { href: link.attrs.href } : {}), ...(fontSize?.type === "fontSize" ? { fontSize: fontSize.attrs.size } : {}) }
      if (item.type === "documentField") {
        if (!Object.hasOwn(values, item.attrs.key)) {
          const field = catalog.fields.find(field => field.key === item.attrs.key)!
          throw new BusinessError(409, `The selected field "${field.label}" has no unambiguous accepted value. ${field.help ?? "Review the source before issuing."}`)
        }
        return { text: values[item.attrs.key], bold: item.marks?.some(mark=>mark.type==="bold"), italic: item.marks?.some(mark=>mark.type==="italic"), ...(item.marks?.some(mark=>mark.type==="underline") ? { underline: true } : {}), ...extra }
      }
      return { text: item.text, bold: item.marks?.some(mark => mark.type === "bold"), italic: item.marks?.some(mark => mark.type === "italic"), ...(item.marks?.some(mark=>mark.type==="underline") ? { underline: true } : {}), ...extra }
    }) }]
  }) }
  return resolve(layout.content)
}
