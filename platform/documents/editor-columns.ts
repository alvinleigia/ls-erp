import { Node, mergeAttributes, isNodeSelection, type Editor } from "@tiptap/core"

export const DocumentColumn = Node.create({
  name: "documentColumn", isolating: true,
  content: "(paragraph | heading | bulletList | orderedList | documentSection | documentPageBreak | horizontalRule)+",
  parseHTML: () => [{ tag: "div[data-document-column]" }],
  renderHTML: ({ HTMLAttributes }) => ["div", mergeAttributes(HTMLAttributes, { "data-document-column": "", class: "min-w-0 rounded border border-dashed p-2 break-words" }), 0],
})
export const DocumentColumns = Node.create({
  name: "documentColumns", group: "block", content: "documentColumn{1,3}", isolating: true,
  parseHTML: () => [{ tag: "div[data-document-columns]" }],
  renderHTML: ({ node, HTMLAttributes }) => ["div", mergeAttributes(HTMLAttributes, { "data-document-columns": "", class: `my-3 grid gap-3 ${node.childCount === 3 ? "sm:grid-cols-3" : node.childCount === 2 ? "sm:grid-cols-2" : "grid-cols-1"}` }), 0],
})

export function selectedColumnRow(editor: Editor) {
  const selection = editor.state.selection
  if (isNodeSelection(selection) && selection.node.type.name === "documentColumns") return { node: selection.node, pos: selection.from }
  for (let depth = selection.$from.depth; depth > 0; depth--) {
    if (selection.$from.node(depth).type.name === "documentColumns") return { node: selection.$from.node(depth), pos: selection.$from.before(depth) }
  }
}

// Reducing the count moves remaining content into the last column. Single column
// unwraps the row. Never discard source sections, fields or wording on resize.
export function setDocumentColumns(editor: Editor, count: number) {
  if (![1, 2, 3].includes(count)) return false
  const row = selectedColumnRow(editor)
  if (row) {
    const columns = Array.from({ length: row.node.childCount }, (_, index) => row.node.child(index).toJSON())
    const content = count === 1 ? columns.flatMap(column => column.content) : Array.from({ length: count }, (_, index) => {
      const blocks = index === count - 1 ? columns.slice(index).flatMap(column => column.content) : columns[index]?.content
      return { type: "documentColumn", content: blocks?.length ? blocks : [{ type: "paragraph" }] }
    })
    const replacement = count === 1 ? content : { type: "documentColumns", content }
    return editor.chain().focus().insertContentAt({ from: row.pos, to: row.pos + row.node.nodeSize }, replacement).setTextSelection(row.pos + (count === 1 ? 1 : 3)).run()
  }
  if (count === 1) return false
  const selection = editor.state.selection
  const pos = selection.$from.depth ? selection.$from.after(1) : selection.to
  return editor.chain().focus().insertContentAt(pos, { type: "documentColumns", content: Array.from({ length: count }, () => ({ type: "documentColumn", content: [{ type: "paragraph" }] })) }).setTextSelection(pos + 3).run()
}
