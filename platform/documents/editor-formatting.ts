import { Extension, Mark } from "@tiptap/core"
import { Fragment, Slice, type Node as EditorNode } from "@tiptap/pm/model"
import { Plugin } from "@tiptap/pm/state"
import { documentLinkSchema } from "./layout"
import { paragraphSpacingSchema, lineSpacingSchema, paragraphSpaceAfter, lineHeight } from "./typography"

function spacingAttribute(element: HTMLElement, key: "paragraphSpacing" | "lineSpacing") {
  const raw = element.dataset[key]
  if (!raw) return null
  const parsed = (key === "paragraphSpacing" ? paragraphSpacingSchema : lineSpacingSchema).safeParse(/^\d+(?:\.\d+)?$/.test(raw) ? Number(raw) : raw)
  return parsed.success ? parsed.data : null
}

// Only these bounded styles survive paste and enter the stored document model.
// Font families, sizes, colours, images, scripts and arbitrary CSS are not nodes.
export const DocumentSpacing = Extension.create({
  name: "documentSpacing",
  addGlobalAttributes: () => [{ types: ["paragraph", "heading"], attributes: {
    paragraphSpacing: { default: null, parseHTML: element => spacingAttribute(element, "paragraphSpacing"), renderHTML: attrs => { const parsed=paragraphSpacingSchema.safeParse(attrs.paragraphSpacing),value=parsed.success?paragraphSpaceAfter(parsed.data):undefined;return value===undefined?{}:{ "data-paragraph-spacing": attrs.paragraphSpacing, style: `margin-top:0;margin-bottom:${value}pt` } } },
    lineSpacing: { default: null, parseHTML: element => spacingAttribute(element, "lineSpacing"), renderHTML: attrs => { const parsed=lineSpacingSchema.safeParse(attrs.lineSpacing),value=parsed.success?lineHeight(parsed.data):undefined;return value===undefined?{}:{ "data-line-spacing": attrs.lineSpacing, style: `line-height:${value}` } } },
  } }],
  addProseMirrorPlugins: () => [new Plugin({
    props: { transformPasted: slice => {
      function clean(node: EditorNode): EditorNode {
        if (node.isText) return node
        const attrs = node.type.name === "orderedList" ? { ...node.attrs, start: Math.max(1, Math.min(9999, Number(node.attrs.start) || 1)), type: null } : node.attrs
        return node.type.create(attrs, Fragment.fromArray(Array.from({ length: node.childCount }, (_, i) => clean(node.child(i)))), node.marks)
      }
      return new Slice(Fragment.fromArray(Array.from({ length: slice.content.childCount }, (_, i) => clean(slice.content.child(i)))), slice.openStart, slice.openEnd)
    } },
    filterTransaction: tr => {
      if (!tr.docChanged) return true
      function allowed(node: EditorNode, depth = 0): boolean {
        const next = depth + (["bulletList", "orderedList"].includes(node.type.name) ? 1 : 0)
        if (next > 3) return false
        for (let i = 0; i < node.childCount; i++) {
          const child = node.child(i)
          if (node.type.name === "listItem" && !["paragraph", "bulletList", "orderedList"].includes(child.type.name)) return false
          if (!allowed(child, next)) return false
        }
        return true
      }
      return allowed(tr.doc)
    },
  })],
})

export const DocumentLink = Mark.create({
  name: "link", inclusive: false,
  addAttributes: () => ({ href: { default: null } }),
  parseHTML: () => [{ tag: "a[href]", getAttrs: element => {
    const href = documentLinkSchema.safeParse(element.getAttribute("href"))
    return href.success ? { href: href.data } : false
  } }],
  renderHTML: ({ HTMLAttributes }) => ["a", { href: HTMLAttributes.href, rel: "noopener noreferrer", class: "underline underline-offset-2" }, 0],
})

export const Superscript = Mark.create({
  name: "superscript", excludes: "subscript",
  parseHTML: () => [{ tag: "sup" }], renderHTML: () => ["sup", 0],
})
export const Subscript = Mark.create({
  name: "subscript", excludes: "superscript",
  parseHTML: () => [{ tag: "sub" }], renderHTML: () => ["sub", 0],
})
