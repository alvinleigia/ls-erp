"use client"
import { InfoHelp } from "@/components/erp/info-help"
import { useEffect, useState } from "react"
import { Node, mergeAttributes, isNodeSelection } from "@tiptap/core"
import { EditorContent, NodeViewWrapper, ReactNodeViewRenderer, useEditor, useEditorState, type NodeViewProps } from "@tiptap/react"
import StarterKit from "@tiptap/starter-kit"
import TextAlign from "@tiptap/extension-text-align"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/erp/controls"
import { Input } from "@/components/ui/input"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog"
import { starterDocumentLayout, type DocumentLayout, type TemplateCatalog } from "./layout"

function TokenView({ node, selected, extension }: NodeViewProps) {
  const catalog = extension.options.catalog as TemplateCatalog
  const section = node.type.name === "documentSection"
  const label = (section ? catalog.sections : catalog.fields).find(row => row.key === node.attrs.key)?.label ?? "Unavailable field"
  return <NodeViewWrapper as={section ? "div" : "span"} contentEditable={false} className={`${section ? "my-3 rounded-md border p-3" : "mx-0.5 inline-block rounded bg-muted px-1.5 text-sm"} ${selected ? "ring-2 ring-ring" : ""}`}>
    <span>{section ? `Section: ${label}` : label}</span>{section && <span className="ml-2 text-xs text-muted-foreground">Saved records populate this section</span>}
  </NodeViewWrapper>
}
const Field = Node.create({
  name: "documentField", group: "inline", inline: true, atom: true,
  addOptions: () => ({ catalog: { fields: [], sections: [] } as TemplateCatalog }),
  addAttributes: () => ({ key: { default: "" } }),
  parseHTML: () => [{ tag: "span[data-document-field]" }],
  renderHTML: ({ HTMLAttributes }) => ["span", mergeAttributes(HTMLAttributes, { "data-document-field": "" }), HTMLAttributes.key],
  addNodeView: () => ReactNodeViewRenderer(TokenView),
})
const DynamicSection = Field.extend({
  name: "documentSection", group: "block", inline: false, draggable: true,
  addAttributes: () => ({ key: { default: "" }, compact: { default: false } }),
  parseHTML: () => [{ tag: "div[data-document-section]" }],
  renderHTML: ({ HTMLAttributes }) => ["div", mergeAttributes(HTMLAttributes, { "data-document-section": "" }), HTMLAttributes.key],
})
const PageBreak = Node.create({
  name: "documentPageBreak", group: "block", atom: true, selectable: true,
  parseHTML: () => [{ tag: "hr[data-document-page-break]" }],
  renderHTML: () => ["hr", { "data-document-page-break": "", "aria-label": "Page break", class: "my-6 border-dashed border-t-2" }],
})

export function DocumentLayoutEditor({ value, catalog, disabled, onChange }: { value: DocumentLayout; catalog: TemplateCatalog; disabled: boolean; onChange: (value: DocumentLayout) => void }) {
  const [search, setSearch] = useState(""), [reset, setReset] = useState(false)
  const editor = useEditor({
    immediatelyRender: false,
    extensions: [StarterKit.configure({ blockquote: false, bulletList: false, orderedList: false, listItem: false, listKeymap: false, code: false, codeBlock: false, horizontalRule: false, link: false, strike: false, underline: false, trailingNode: false, heading: { levels: [1, 2, 3] } }), TextAlign.configure({ types: ["heading", "paragraph"], alignments: ["left", "center", "right"] }), Field.configure({ catalog }), DynamicSection.configure({ catalog }), PageBreak],
    content: value, editable: !disabled,
    editorProps: { attributes: { role: "textbox", "aria-label": "Document layout", "aria-multiline": "true", class: "min-h-80 p-4 outline-none [&_h1]:text-2xl [&_h1]:font-semibold [&_h2]:text-xl [&_h2]:font-semibold [&_h3]:text-lg [&_h3]:font-semibold [&_p]:my-2" } },
    onUpdate: ({ editor }) => onChange(editor.getJSON() as DocumentLayout),
  })
  const active = useEditorState({ editor, selector: ({ editor }) => ({ bold: editor?.isActive("bold") ?? false, italic: editor?.isActive("italic") ?? false, section: editor?.isActive("documentSection") ?? false, compact: editor?.getAttributes("documentSection").compact === true }) })
  useEffect(() => { editor?.setEditable(!disabled, false) }, [editor, disabled])
  useEffect(() => { if (editor && JSON.stringify(editor.getJSON()) !== JSON.stringify(value)) editor.commands.setContent(value, { emitUpdate: false }) }, [editor, value])
  const busy = disabled || !editor
  function insertDynamic(key: string, section = false) {
    if (!editor || disabled) return
    const node = { type: section ? "documentSection" : "documentField", attrs: { key } }
    const selection = editor.state.selection
    // A selected source section is a whole block. Inserting a new variable must
    // not silently replace it and discard repeated customers or payment rows.
    if (isNodeSelection(selection) && selection.node.isBlock) {
      editor.chain().focus().insertContentAt(selection.to, section ? node : { type: "paragraph", content: [node] }).run()
    } else editor.chain().focus().insertContent(node).run()
    editor.view.focus()
  }
  const query = search.trim().toLowerCase()
  const groupNames: Record<string, string> = { document: "Document", company: "Company", customer: "Customer", order: "Booking and order", bank: "Bank details", template: "Wording", payment: "Payment", invoice: "Invoice", credit: "Credit note", quote: "Quotation", supplier: "Supplier" }
  const groups: Record<string, TemplateCatalog["fields"]> = {}
  for (const field of catalog.fields) {
    const group = field.group ?? groupNames[field.key.split(".")[0]] ?? "Other fields"
    if (!`${field.label} ${group}`.toLowerCase().includes(query)) continue
    ;(groups[group] ??= []).push(field)
  }
  const sections = catalog.sections.filter(section => `${section.label} repeating sections`.toLowerCase().includes(query))
  return <div className="space-y-3">

    <div className="flex flex-wrap items-center gap-2">
      <div className="flex items-center gap-2"><span className="text-sm font-medium">Layout tools</span><InfoHelp title="Document layout">Click in the document, then insert a field or section from the side panel. Select text or a field to make it bold or italic. Enter adds a paragraph; Shift + Enter adds a line break. Empty paragraphs add spacing. Use the PDF preview to check page breaks. Select a section to cut/paste it elsewhere. Required sections must appear once; empty optional data adds no rows. Company branding, document reference and page numbers are included automatically.</InfoHelp></div>
      <Button type="button" size="sm" variant="outline" aria-label="Bold" aria-pressed={active?.bold} disabled={busy} onClick={() => editor?.chain().focus().toggleBold().run()}>Bold</Button>
      <Button type="button" size="sm" variant="outline" aria-label="Italic" aria-pressed={active?.italic} disabled={busy} onClick={() => editor?.chain().focus().toggleItalic().run()}>Italic</Button>
      <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => editor?.chain().focus().insertContentAt(editor.state.doc.content.size, { type: "paragraph" }).run()}>Add paragraph</Button>
      <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => editor?.chain().focus().toggleHeading({ level: 2 }).run()}>Heading</Button>
      {(["left", "center", "right"] as const).map(align => <Button key={align} type="button" size="sm" variant="outline" disabled={busy} onClick={() => editor?.chain().focus().setTextAlign(align).run()}>{align[0].toUpperCase() + align.slice(1)}</Button>)}
      <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => editor?.chain().focus().insertContent({ type: "documentPageBreak" }).run()}>Page break</Button>
      <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => setReset(true)}>Use starter layout</Button>
    </div>
    <div className="grid min-w-0 items-start gap-4 xl:grid-cols-[minmax(0,1fr)_18rem]">
      <div className="min-w-0 space-y-3">
        <div className="rounded-lg border bg-background"><EditorContent editor={editor} /></div>
        {active?.section && <label className="flex items-start gap-2"><Checkbox checked={active.compact} disabled={busy} onChange={event => editor?.chain().focus().updateAttributes("documentSection", { compact: event.target.checked }).run()} />Show table rows in this section as compact labelled details</label>}
      </div>
      <aside aria-label="Insert dynamic content" className="order-first min-w-0 rounded-lg border bg-muted/20 p-3 xl:order-none xl:sticky xl:top-4">
        <div className="mb-3 flex items-center gap-2"><h3 className="font-medium">Insert dynamic content</h3><InfoHelp title="Insert dynamic content">Place the cursor in the document, then choose a field. Fixed labels can be typed and formatted normally. Sections repeat all accepted records, including multiple customers, units and instalments. Required sections must remain, or be replaced by every listed alternative field. Single-record fields cannot represent multiple records; use a repeating section instead. Searching does not change your draft.</InfoHelp></div>
        <Input aria-label="Find fields or sections" placeholder="Find fields or sections..." value={search} onChange={event => setSearch(event.target.value)} />
        <div className="mt-3 max-h-72 space-y-3 overflow-y-auto overscroll-contain xl:max-h-[60vh]">
          {Object.entries(groups).map(([group, fields]) => <details key={group} open className="min-w-0">
            <summary className="cursor-pointer text-sm font-medium">{group}</summary>
            <div className="mt-1 space-y-1">{fields.map(field => <Button key={field.key} type="button" variant="ghost" size="sm" className="h-auto w-full justify-start whitespace-normal text-left" aria-label={`Insert ${field.label}`} disabled={busy} onMouseDown={event => event.preventDefault()} onClick={() => insertDynamic(field.key)}>{field.label}</Button>)}</div>
          </details>)}
          {sections.length > 0 && <details open><summary className="cursor-pointer text-sm font-medium">Repeating sections</summary><div className="mt-1 space-y-1">{sections.map(section => <div key={section.key}>
            <Button type="button" variant="ghost" size="sm" className="h-auto w-full justify-start whitespace-normal text-left" aria-label={`Insert section: ${section.label}`} disabled={busy} onMouseDown={event => event.preventDefault()} onClick={() => insertDynamic(section.key, true)}>{section.label}{section.required ? " (required)" : ""}</Button>
            {section.alternativeFields?.length ? <p className="px-3 text-xs text-muted-foreground">Or insert all individual fields: {section.alternativeFields.map(key => catalog.fields.find(field => field.key === key)?.label ?? key).join(", ")}.</p> : null}
          </div>)}</div></details>}
          {!Object.keys(groups).length && !sections.length && <p className="text-sm text-muted-foreground" role="status">No matching fields or sections.</p>}
        </div>
      </aside>
    </div>

    <Dialog open={reset} onOpenChange={setReset}><DialogContent><DialogHeader><DialogTitle>Use the starter layout?</DialogTitle><DialogDescription>This replaces the unsaved layout. Company details and approved wording are retained. Published versions and issued PDFs stay unchanged.</DialogDescription></DialogHeader><DialogFooter><Button type="button" variant="outline" onClick={() => setReset(false)}>Cancel</Button><Button type="button" onClick={() => { onChange(starterDocumentLayout(catalog)); setReset(false) }}>Replace layout</Button></DialogFooter></DialogContent></Dialog>
  </div>
}
