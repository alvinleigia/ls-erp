import type { Prisma } from "@prisma/client"
import type { BusinessActor } from "@/platform/policy"
import { BusinessError } from "@/platform/policy"
import { importReportColumns } from "@/platform/imports/types"
export type CatalogImportColumn = { key: string; required?: boolean; help: string; options?: string[] }
export type CatalogImportProfile = {
  key: string; label: string; columns: CatalogImportColumn[]
  authorize: (tx: Prisma.TransactionClient, actor: BusinessActor) => Promise<void>
  extend: (tx: Prisma.TransactionClient, actor: BusinessActor, row: Record<string, string>) => Promise<Record<string, unknown>>
}
export const catalogImportColumns: CatalogImportColumn[] = [
  { key: "item_code", required: true, help: "Unique business-wide code; letters, numbers, dots, slashes or hyphens. Existing codes are skipped." },
  { key: "item_name", required: true, help: "Item display name." },
  { key: "kind", required: true, help: "PRODUCT for repeatable products; UNIT for individually identified inventory.", options: ["PRODUCT", "UNIT"] },
  { key: "sales_unit", required: true, help: "Quantity label, for example each, plot or apartment. Unit price is for one of these." },
  { key: "unit_price", required: true, help: "Price for one sales unit, excluding separately quoted charges. Plain number, up to four decimals; no commas or currency symbols. Enter 0 only if intentionally free." },
  { key: "currency", required: true, help: "Three-letter currency code, for example INR or USD." },
  { key: "availability", required: true, help: "AVAILABLE, UNAVAILABLE or SOLD (UNIT only). Booked/held stock without migrated agreements must be UNAVAILABLE; this does not create a booking.", options: ["AVAILABLE", "UNAVAILABLE", "SOLD"] },
  { key: "description", help: "Optional item description." },
]
export const basicCatalogImportProfile: CatalogImportProfile = { key: "catalog", label: "Products and units", columns: [], authorize: async () => {}, extend: async () => ({ extensionKey: null }) }
export const templateColumns = (profile: CatalogImportProfile) => [...catalogImportColumns, ...profile.columns]
export function checkTemplateHeaders(headers: string[], profile: CatalogImportProfile) {
  const expected = templateColumns(profile).map(column => column.key)
  const corrected = [...expected, ...importReportColumns]
  if (![expected, corrected].some(keys => keys.length === headers.length && keys.every((key, i) => headers[i] === key))) throw new BusinessError(400, "The columns do not match this template. Download a fresh template and keep its headings and column order unchanged.")
  return expected
}
export function catalogRowInput(row: Record<string, string>) {
  return { code: row.item_code, name: row.item_name, kind: row.kind.toUpperCase(), unit: row.sales_unit, price: row.unit_price, currency: row.currency.toUpperCase(), availability: row.availability.toUpperCase(), description: row.description, archived: false }
}
export async function catalogImportWorkbook(profile: CatalogImportProfile) {
  const { default: ExcelJS } = await import("exceljs")
  const book = new ExcelJS.Workbook(), sheet = book.addWorksheet("Items"), instructions = book.addWorksheet("Instructions")
  const columns = templateColumns(profile)
  sheet.addRow(columns.map(column => column.key)); sheet.views = [{ state: "frozen", ySplit: 1 }]
  sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } }; sheet.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF243746" } }
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columns.length } }
  columns.forEach((column, i) => {
    sheet.getColumn(i + 1).width = column.key === "description" ? 45 : 24
    sheet.getColumn(i + 1).numFmt = "@"
    sheet.getCell(1, i + 1).note = `${column.required ? "Required. " : "Optional. "}${column.help}`
    if (column.options) for (let row = 2; row <= 1001; row++) sheet.getCell(row, i + 1).dataValidation = { type: "list", allowBlank: !column.required, formulae: [`"${column.options.join(",")}"`], showErrorMessage: true, errorTitle: "Choose a listed value", error: column.options.join(", ") }
  })
  instructions.columns = [{ width: 26 }, { width: 15 }, { width: 110 }]
  instructions.addRow([`${profile.label} import - template v1`])
  instructions.addRow(["Fill Items only. Keep headings unchanged. Delete unused blank rows. CSV exports of Items are also accepted."])
  instructions.addRow(["Up to 1,000 rows / 3 MB. No formulas. Validate before importing. Existing records are never updated."])
  instructions.addRow(["Projects, categories and launch phases must already exist and be accessible. No setup records are created by import."])
  instructions.addRow(["Field", "Required", "Instructions"])
  columns.forEach(column => instructions.addRow([column.key, column.required ? "Yes" : "No", column.help]))
  for (let row = 1; row <= 4; row++) { instructions.mergeCells(row, 1, row, 3); instructions.getRow(row).height = row === 1 ? 25 : 32 }
  instructions.eachRow(row => { row.alignment = { vertical: "top", wrapText: true } }); instructions.getRow(1).font = { bold: true }; instructions.getRow(5).font = { bold: true }
  return new Uint8Array(await book.xlsx.writeBuffer())
}
