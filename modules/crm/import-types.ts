export type ImportChoice = { id: string; name: string; aliases?: string[]; parentId?: string | null }
export type ImportField = {
  key: string; label: string; type?: "text" | "date" | "number" | "boolean" | "choice"
  required?: boolean; choices?: ImportChoice[]; aliases?: string[]; defaultValue?: string; salesTeamId?: string | null
}
export type ImportConfig = { mapping: Record<string, number>; defaults: Record<string, string> }
export type ImportIssue = { field: string; message: string }
export const IMPORT_MAX_ROWS = 1000
export const IMPORT_MAX_BYTES = 3 * 1024 * 1024
export const importReportColumns = ["Import row", "Import status", "Import errors"]
export const baseImportFields: ImportField[] = [
  { key: "name", label: "Contact name", required: true, aliases: ["name", "customer", "customer name", "full name"] },
  { key: "email", label: "Email", aliases: ["email address", "e-mail"] },
  { key: "phone", label: "Phone", aliases: ["mobile", "mobile number", "phone number", "telephone"] },
  { key: "title", label: "Enquiry title", aliases: ["title", "enquiry", "lead title"] },
  { key: "requirements", label: "Requirements", aliases: ["notes", "description", "comments"] },
  { key: "targetCloseOn", label: "Target close date", type: "date", aliases: ["target close"] },
  ...["addressLine1", "addressLine2", "city", "region", "postalCode", "country"].map((key, i) => ({ key, label: ["Address line 1", "Address line 2", "City", "State / region", "Postal code", "Country"][i] })),
]
export function suggestImportMapping(headers: string[], fields: ImportField[]) {
  const normalize = (s: string) => s.trim().toLowerCase().replace(/[_-]/g, " ")
  const mapping: Record<string, number> = {}
  const used = new Set<number>()
  for (const field of fields) {
    const names = [field.key, field.label, ...(field.aliases || [])].map(normalize)
    const column = headers.findIndex((h, i) => !used.has(i) && names.includes(normalize(h)))
    if (column >= 0) { mapping[field.key] = column; used.add(column) }
  }
  return mapping
}
