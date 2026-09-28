import { CrmError } from "./policy"

export const CRM_EXPORT_LIMIT = 2000
export function checkExportLimit(total: number) {
  if (total > CRM_EXPORT_LIMIT) throw new CrmError(400, `This export exceeds ${CRM_EXPORT_LIMIT.toLocaleString("en-US")} rows. Narrow the filters and try again.`)
}

// Quote every cell, including embedded commas/newlines. Treat formula-like
// values (including international phone numbers) as text in spreadsheets.
export function crmCsv(headers: string[], rows: unknown[][]) {
  const cell = (value: unknown) => {
    let text = value instanceof Date ? value.toISOString() : value == null ? "" : String(value)
    if (/^[\s\u0000-\u001f]*[=+@-]/u.test(text) || /^[\t\r\n]/u.test(text)) text = `'${text}`
    return `"${text.replaceAll('"', '""')}"`
  }
  return "\uFEFF" + [headers, ...rows].map(row => row.map(cell).join(",")).join("\r\n") + "\r\n"
}
