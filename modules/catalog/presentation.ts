import type { Prisma } from "@prisma/client"
import type { BusinessActor } from "@/platform/policy"
import type { CatalogExtension, CatalogPresentation } from "./contracts"

// Quotation descriptions have a 300-character contract. Keep complete labels in
// selectors and frozen references, but never copy an overlong hierarchy into it.
export function catalogDocumentDescription(value: string) {
  if (value.length <= 300) return value
  let result = ""
  for (const character of value) { if (result.length + character.length > 299) break; result += character }
  return `${result.trimEnd()}…`
}

export async function catalogPresentation(tx: Prisma.TransactionClient, actor: BusinessActor, extensions: readonly CatalogExtension[], rows: { id: string; code: string; name: string; extensionKey: string | null }[]) {
  const result = new Map<string, CatalogPresentation>(rows.map(row => [row.id, { displayName: row.name, displayCode: row.code, selectionLabel: `${row.code} · ${row.name}`, documentDescription: `${row.code} · ${row.name}` }]))
  for (const extension of extensions) {
    const ids = rows.filter(row => row.extensionKey === extension.key).map(row => row.id)
    if (ids.length && extension.presentation) for (const [id, display] of await extension.presentation(tx, actor, ids)) result.set(id, display)
  }
  for (const [id, display] of result) result.set(id, { ...display, documentDescription: catalogDocumentDescription(display.documentDescription) })
  return result
}
