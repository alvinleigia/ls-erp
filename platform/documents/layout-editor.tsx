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
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { AlignCenter, AlignLeft, AlignRight, Bold, Heading2, Italic, Link, List, ListOrdered, Minus, Pilcrow, PilcrowLeft, Redo2, RotateCcw, SeparatorHorizontal, Subscript as SubscriptIcon, Superscript as SuperscriptIcon, Underline, Undo2, WrapText, Eraser, type LucideIcon } from "lucide-react"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog"
import { documentLinkSchema, documentValueKey, inlineDocumentWording, starterDocumentLayout, type DocumentLayout, type TemplateCatalog } from "./layout"
import { DocumentSpacing, DocumentLink, Superscript, Subscript } from "./editor-formatting"

function FormatButton({ label, icon: Icon, disabled, pressed, onClick }: { label: string; icon: LucideIcon; disabled: boolean; pressed?: boolean; onClick: () => void }) {
  return <Tooltip delayDuration={250}><TooltipTrigger asChild>
    <Button type="button" variant="ghost" size="icon-sm" aria-label={label} aria-pressed={pressed} disabled={disabled} className="rounded-sm text-muted-foreground hover:text-foreground aria-pressed:bg-accent aria-pressed:text-accent-foreground" onMouseDown={event => event.preventDefault()} onClick={onClick}><Icon className="size-4" aria-hidden="true" /></Button>
  </TooltipTrigger><TooltipContent side="top" sideOffset={6}>{label}</TooltipContent></Tooltip>
}

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
  name: "documentPageBreak", priority: 1000, group: "block", atom: true, selectable: true,
  parseHTML: () => [{ tag: "hr[data-document-page-break]" }],
  renderHTML: () => ["hr", { "data-document-page-break": "", "aria-label": "Page break", class: "my-6 border-dashed border-t-2" }],
})

export function DocumentLayoutEditor({ value, catalog, disabled, onChange, starterWording }: { value: DocumentLayout; catalog: TemplateCatalog; disabled: boolean; onChange: (value: DocumentLayout) => void; starterWording?: { opening: string; terms: string } }) {
  const [search, setSearch] = useState(""), [reset, setReset] = useState(false)
  const [linkOpen, setLinkOpen] = useState(false), [linkUrl, setLinkUrl] = useState(""), [linkError, setLinkError] = useState("")
  const editor = useEditor({
    immediatelyRender: false,
    extensions: [StarterKit.configure({ blockquote: false, code: false, codeBlock: false, link: false, strike: false, trailingNode: false, heading: { levels: [1, 2, 3] } }), DocumentSpacing, DocumentLink, Superscript, Subscript, TextAlign.configure({ types: ["heading", "paragraph"], alignments: ["left", "center", "right"] }), Field.configure({ catalog }), DynamicSection.configure({ catalog }), PageBreak],
    content: value, editable: !disabled,
    editorProps: { attributes: { role: "textbox", "aria-label": "Document layout", "aria-multiline": "true", class: "min-h-80 whitespace-pre-wrap p-4 outline-none [&_h1]:text-2xl [&_h1]:font-semibold [&_h2]:text-xl [&_h2]:font-semibold [&_h3]:text-lg [&_h3]:font-semibold [&_p]:my-2 [&_hr]:my-4 [&_hr]:border-t [&_ul]:list-disc [&_ol]:list-decimal [&_ul]:pl-6 [&_ol]:pl-6 [&_sup]:text-[0.7em] [&_sub]:text-[0.7em]" }, handleClick: (_view, _pos, event) => { if ((event.target as HTMLElement).closest("a")) { event.preventDefault(); return true } return false } },
    onUpdate: ({ editor }) => onChange(editor.getJSON() as DocumentLayout),
  })
  const active = useEditorState({ editor, selector: ({ editor }) => ({ bold: editor?.isActive("bold") ?? false, italic: editor?.isActive("italic") ?? false, underline: editor?.isActive("underline") ?? false, superscript: editor?.isActive("superscript") ?? false, subscript: editor?.isActive("subscript") ?? false, heading: editor?.isActive("heading", { level: 2 }) ?? false, link: editor?.isActive("link") ?? false, left: editor?.isActive({ textAlign: "left" }) ?? false, center: editor?.isActive({ textAlign: "center" }) ?? false, right: editor?.isActive({ textAlign: "right" }) ?? false, bulletList: editor?.isActive("bulletList") ?? false, orderedList: editor?.isActive("orderedList") ?? false, paragraphSpacing: editor?.getAttributes(editor.isActive("heading") ? "heading" : "paragraph").paragraphSpacing ?? "", lineSpacing: editor?.getAttributes(editor.isActive("heading") ? "heading" : "paragraph").lineSpacing ?? "", undo: editor?.can().undo() ?? false, redo: editor?.can().redo() ?? false, section: editor?.isActive("documentSection") ?? false, compact: editor?.getAttributes("documentSection").compact === true }) })
  useEffect(() => { editor?.setEditable(!disabled, false) }, [editor, disabled])
  useEffect(() => { if (editor && documentValueKey(editor.getJSON()) !== documentValueKey(value)) editor.commands.setContent(value, { emitUpdate: false }) }, [editor, value])
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
    if (starterWording && ["template.opening", "template.terms"].includes(field.key)) continue
    const group = field.group ?? groupNames[field.key.split(".")[0]] ?? "Other fields"
    if (!`${field.label} ${group}`.toLowerCase().includes(query)) continue
    ;(groups[group] ??= []).push(field)
  }
  const sections = catalog.sections.filter(section => `${section.label} repeating sections`.toLowerCase().includes(query))
  return <div className="space-y-3">

    <div className="grid min-w-0 items-start gap-4 xl:grid-cols-[minmax(0,1fr)_18rem]">
      <div className="min-w-0 space-y-3">
        <div className="rounded-lg border bg-background">
          <div role="group" aria-label="Document formatting" className="rounded-t-lg border-b bg-muted/30 p-1.5">
            <div className="flex flex-wrap items-center gap-y-1">
              <div role="group" aria-label="History" className="mr-1 flex items-center border-r pr-1">
                <FormatButton label="Undo" icon={Undo2} disabled={busy || !active?.undo} onClick={() => editor?.chain().focus().undo().run()} />
                <FormatButton label="Redo" icon={Redo2} disabled={busy || !active?.redo} onClick={() => editor?.chain().focus().redo().run()} />
              </div>
              <div role="group" aria-label="Text formatting" className="mr-1 flex items-center border-r pr-1">
                <FormatButton label="Heading" icon={Heading2} pressed={active?.heading} disabled={busy} onClick={() => editor?.chain().focus().toggleHeading({ level: 2 }).run()} />
                <FormatButton label="Bold" icon={Bold} pressed={active?.bold} disabled={busy} onClick={() => editor?.chain().focus().toggleBold().run()} />
                <FormatButton label="Italic" icon={Italic} pressed={active?.italic} disabled={busy} onClick={() => editor?.chain().focus().toggleItalic().run()} />
                <FormatButton label="Underline" icon={Underline} pressed={active?.underline} disabled={busy} onClick={() => editor?.chain().focus().toggleUnderline().run()} />
              </div>
              <div role="group" aria-label="Inline formatting" className="mr-1 flex items-center border-r pr-1">
                <FormatButton label="Superscript" icon={SuperscriptIcon} pressed={active?.superscript} disabled={busy} onClick={() => editor?.chain().focus().toggleMark("superscript").run()} />
                <FormatButton label="Subscript" icon={SubscriptIcon} pressed={active?.subscript} disabled={busy} onClick={() => editor?.chain().focus().toggleMark("subscript").run()} />
                <FormatButton label="Link" icon={Link} pressed={active?.link} disabled={busy} onClick={() => { setLinkUrl(editor?.getAttributes("link").href ?? ""); setLinkError(""); setLinkOpen(true) }} />
                <FormatButton label="Clear formatting" icon={Eraser} disabled={busy} onClick={() => {
                  if (!editor) return
                  editor.chain().focus().unsetAllMarks().command(({ tr, state }) => { tr.doc.nodesBetween(tr.selection.from, tr.selection.to, (node, pos) => { if (["paragraph", "heading"].includes(node.type.name)) tr.setNodeMarkup(pos, state.schema.nodes.paragraph) }); return true }).run()
                }} />
              </div>
              <div role="group" aria-label="Alignment" className="flex items-center">
                {([{ align: "left", icon: AlignLeft }, { align: "center", icon: AlignCenter }, { align: "right", icon: AlignRight }] as const).map(({ align, icon }) => <FormatButton key={align} label={align[0].toUpperCase() + align.slice(1)} icon={icon} pressed={active?.[align]} disabled={busy} onClick={() => editor?.chain().focus().setTextAlign(align).run()} />)}
              </div>
              <div className="ml-auto flex items-center"><InfoHelp title="Document layout">Select text or a field to format it. Enter adds a paragraph; Shift + Enter adds a line break. Spacing applies to selected paragraphs; Default follows PDF style. Lists support up to three levels. Pasting retains supported text, lists, links and formatting while dropping external fonts, colours, images and unsupported styles. Clear formatting restores normal text and spacing without deleting tags or repeating sections. Links accept http, https or mailto addresses and become clickable in the PDF. Use the PDF preview to check pagination. Required sections must remain. Company branding, reference and page numbers are automatic.</InfoHelp></div>
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-y-1 border-t pt-1">
              <div role="group" aria-label="Lists" className="mr-1 flex items-center border-r pr-1">
                <FormatButton label="Bulleted list" icon={List} pressed={active?.bulletList} disabled={busy} onClick={() => editor?.chain().focus().toggleBulletList().run()} />
                <FormatButton label="Numbered list" icon={ListOrdered} pressed={active?.orderedList} disabled={busy} onClick={() => editor?.chain().focus().toggleOrderedList().run()} />
              </div>
              <div role="group" aria-label="Spacing" className="mr-1 flex flex-wrap items-center gap-1 border-r pr-1">
                <label className="flex items-center gap-1 pl-1 text-muted-foreground"><Pilcrow className="size-4" aria-hidden="true" /><span className="sr-only">Paragraph spacing</span><Tooltip delayDuration={250}><TooltipTrigger asChild><select aria-label="Paragraph spacing" className="h-8 w-24 rounded-sm bg-transparent px-1 text-xs text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring" disabled={busy} value={active?.paragraphSpacing ?? ""} onChange={event => editor?.chain().focus().updateAttributes("paragraph", { paragraphSpacing: event.target.value || null }).updateAttributes("heading", { paragraphSpacing: event.target.value || null }).run()}><option value="">Default</option><option value="compact">Compact</option><option value="normal">Normal</option><option value="relaxed">Relaxed</option></select></TooltipTrigger><TooltipContent sideOffset={6}>Paragraph spacing</TooltipContent></Tooltip></label>
                <label className="flex items-center gap-1 pl-1 text-muted-foreground"><WrapText className="size-4" aria-hidden="true" /><span className="sr-only">Line spacing</span><Tooltip delayDuration={250}><TooltipTrigger asChild><select aria-label="Line spacing" className="h-8 w-24 rounded-sm bg-transparent px-1 text-xs text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring" disabled={busy} value={active?.lineSpacing ?? ""} onChange={event => editor?.chain().focus().updateAttributes("paragraph", { lineSpacing: event.target.value || null }).updateAttributes("heading", { lineSpacing: event.target.value || null }).run()}><option value="">Default</option><option value="single">Single</option><option value="one-and-half">1.5 lines</option><option value="double">Double</option></select></TooltipTrigger><TooltipContent sideOffset={6}>Line spacing</TooltipContent></Tooltip></label>
              </div>
              <div role="group" aria-label="Insert blocks" className="flex items-center">
                <FormatButton label="Add paragraph" icon={PilcrowLeft} disabled={busy} onClick={() => editor?.chain().focus().insertContentAt(editor.state.doc.content.size, { type: "paragraph" }).run()} />
                <FormatButton label="Page break" icon={SeparatorHorizontal} disabled={busy} onClick={() => editor?.chain().focus().insertContent({ type: "documentPageBreak" }).run()} />
                <FormatButton label="Separator" icon={Minus} disabled={busy} onClick={() => { if(!editor)return;const selection=editor.state.selection;editor.chain().focus().insertContentAt(isNodeSelection(selection)&&selection.node.isBlock?selection.to:selection.from,{type:"horizontalRule"}).run();editor.view.focus() }} />
              </div>
              <div className="ml-auto"><FormatButton label="Use starter layout" icon={RotateCcw} disabled={busy} onClick={() => setReset(true)} /></div>
            </div>
          </div>

          <EditorContent editor={editor} />
        </div>
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

    <Dialog open={linkOpen} onOpenChange={setLinkOpen}><DialogContent><DialogHeader><DialogTitle>Link selected text</DialogTitle><DialogDescription>Use a website or email address. The link opens from the PDF, not while editing.</DialogDescription></DialogHeader><label className="space-y-2">Link address<Input aria-label="Link address" placeholder="https://example.com or mailto:name@example.com" disabled={busy} value={linkUrl} onChange={event => { setLinkUrl(event.target.value); setLinkError("") }} /></label>{linkError && <p role="alert" className="text-sm text-destructive">{linkError}</p>}<DialogFooter><Button type="button" variant="outline" disabled={busy} onClick={() => { editor?.chain().focus().extendMarkRange("link").unsetMark("link").run(); setLinkOpen(false) }}>Remove link</Button><Button type="button" variant="outline" onClick={() => setLinkOpen(false)}>Cancel</Button><Button type="button" disabled={busy} onClick={() => { const parsed = documentLinkSchema.safeParse(linkUrl); if (!parsed.success) { setLinkError(parsed.error.issues[0].message); return } editor?.chain().focus().extendMarkRange("link").setMark("link", { href: parsed.data }).run(); setLinkOpen(false) }}>Apply link</Button></DialogFooter></DialogContent></Dialog>

    <Dialog open={reset} onOpenChange={setReset}><DialogContent><DialogHeader><DialogTitle>Use the starter layout?</DialogTitle><DialogDescription>{starterWording?"This replaces the document body, including edited wording and formatting, with the starter content. The document title, company details and PDF style are retained.":"This replaces the unsaved layout. Company details and approved wording are retained."} Published versions and issued PDFs stay unchanged.</DialogDescription></DialogHeader><DialogFooter><Button type="button" variant="outline" onClick={() => setReset(false)}>Cancel</Button><Button type="button" onClick={() => { const layout=starterDocumentLayout(catalog);onChange(starterWording?inlineDocumentWording(layout,starterWording):layout);setReset(false) }}>Replace layout</Button></DialogFooter></DialogContent></Dialog>
  </div>
}
