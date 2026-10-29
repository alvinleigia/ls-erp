"use client"
import { useEffect, useState } from "react"
import { Node, mergeAttributes } from "@tiptap/core"
import { EditorContent, NodeViewWrapper, ReactNodeViewRenderer, useEditor, useEditorState, type NodeViewProps } from "@tiptap/react"
import StarterKit from "@tiptap/starter-kit"
import TextAlign from "@tiptap/extension-text-align"
import { Button } from "@/components/ui/button"
import { Select } from "@/components/erp/controls"
import { FormField } from "@/components/form-field"
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
  addAttributes: () => ({ key: { default: "" } }),
  parseHTML: () => [{ tag: "div[data-document-section]" }],
  renderHTML: ({ HTMLAttributes }) => ["div", mergeAttributes(HTMLAttributes, { "data-document-section": "" }), HTMLAttributes.key],
})
const PageBreak = Node.create({
  name: "documentPageBreak", group: "block", atom: true, selectable: true,
  parseHTML: () => [{ tag: "hr[data-document-page-break]" }],
  renderHTML: () => ["hr", { "data-document-page-break": "", "aria-label": "Page break", class: "my-6 border-dashed border-t-2" }],
})

export function DocumentLayoutEditor({ value, catalog, disabled, onChange }: { value: DocumentLayout; catalog: TemplateCatalog; disabled: boolean; onChange: (value: DocumentLayout) => void }) {
  const [field, setField] = useState(catalog.fields[0]?.key ?? ""), [section, setSection] = useState(catalog.sections[0]?.key ?? ""), [reset, setReset] = useState(false)
  const editor = useEditor({
    immediatelyRender: false,
    extensions: [StarterKit.configure({ blockquote: false, bulletList: false, orderedList: false, listItem: false, listKeymap: false, code: false, codeBlock: false, horizontalRule: false, link: false, strike: false, underline: false, trailingNode: false, heading: { levels: [1, 2, 3] } }), TextAlign.configure({ types: ["heading", "paragraph"], alignments: ["left", "center", "right"] }), Field.configure({ catalog }), DynamicSection.configure({ catalog }), PageBreak],
    content: value, editable: !disabled,
    editorProps: { attributes: { role: "textbox", "aria-label": "Document layout", "aria-multiline": "true", class: "min-h-80 p-4 outline-none [&_h1]:text-2xl [&_h1]:font-semibold [&_h2]:text-xl [&_h2]:font-semibold [&_h3]:text-lg [&_h3]:font-semibold [&_p]:my-2" } },
    onUpdate: ({ editor }) => onChange(editor.getJSON() as DocumentLayout),
  })
  const active = useEditorState({ editor, selector: ({ editor }) => ({ bold: editor?.isActive("bold") ?? false, italic: editor?.isActive("italic") ?? false }) })
  useEffect(() => { editor?.setEditable(!disabled, false) }, [editor, disabled])
  useEffect(() => { if (editor && JSON.stringify(editor.getJSON()) !== JSON.stringify(value)) editor.commands.setContent(value, { emitUpdate: false }) }, [editor, value])
  const busy = disabled || !editor
  return <div className="space-y-3">
    <p className="text-sm text-muted-foreground">Edit the wording and insert fields where you need them. Select a section to cut/paste it elsewhere. Required sections must appear once; empty optional data adds no rows. Company branding, document reference and page numbers are included automatically.</p>
    <div className="flex flex-wrap items-end gap-2">
      <Button type="button" size="sm" variant="outline" aria-label="Bold" aria-pressed={active?.bold} disabled={busy} onClick={() => editor?.chain().focus().toggleBold().run()}>Bold</Button>
      <Button type="button" size="sm" variant="outline" aria-label="Italic" aria-pressed={active?.italic} disabled={busy} onClick={() => editor?.chain().focus().toggleItalic().run()}>Italic</Button>
      <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => editor?.chain().focus().insertContentAt(editor.state.doc.content.size, { type: "paragraph" }).run()}>Add paragraph</Button>
      <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => editor?.chain().focus().toggleHeading({ level: 2 }).run()}>Heading</Button>
      {(["left", "center", "right"] as const).map(align => <Button key={align} type="button" size="sm" variant="outline" disabled={busy} onClick={() => editor?.chain().focus().setTextAlign(align).run()}>{align[0].toUpperCase() + align.slice(1)}</Button>)}
      <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => editor?.chain().focus().insertContent({ type: "documentPageBreak" }).run()}>Page break</Button>
      <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => setReset(true)}>Use starter layout</Button>
    </div>
    <div className="grid items-end gap-3 sm:grid-cols-[1fr_auto_1fr_auto]">
      <FormField id="template-insert-field" label="Dynamic field"><Select id="template-insert-field" value={field} onValueChange={setField} disabled={busy}>{catalog.fields.map(row => <option key={row.key} value={row.key}>{row.label}</option>)}</Select></FormField>
      <Button type="button" variant="outline" disabled={busy || !field} onClick={() => editor?.chain().focus().insertContent({ type: "documentField", attrs: { key: field } }).run()}>Insert field</Button>
      <FormField id="template-insert-section" label="Dynamic section"><Select id="template-insert-section" value={section} onValueChange={setSection} disabled={busy}>{catalog.sections.map(row => <option key={row.key} value={row.key}>{row.label}{row.required ? " (required)" : ""}</option>)}</Select></FormField>
      <Button type="button" variant="outline" disabled={busy || !section} onClick={() => editor?.chain().focus().insertContent({ type: "documentSection", attrs: { key: section } }).run()}>Insert section</Button>
    </div>
    <div className="rounded-lg border bg-background"><EditorContent editor={editor} /></div>
    <p className="text-xs text-muted-foreground">The payment schedule displays saved instalments. Editing this layout does not change prices, payments or balances. Use the PDF preview to check printed page breaks.</p>
    <Dialog open={reset} onOpenChange={setReset}><DialogContent><DialogHeader><DialogTitle>Use the starter layout?</DialogTitle><DialogDescription>This replaces the unsaved layout. Company details and approved wording are retained. Published versions and issued PDFs stay unchanged.</DialogDescription></DialogHeader><DialogFooter><Button type="button" variant="outline" onClick={() => setReset(false)}>Cancel</Button><Button type="button" onClick={() => { onChange(starterDocumentLayout(catalog)); setReset(false) }}>Replace layout</Button></DialogFooter></DialogContent></Dialog>
  </div>
}
