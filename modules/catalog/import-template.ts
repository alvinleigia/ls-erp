import type { Prisma } from "@prisma/client"
import type { BusinessActor } from "@/platform/policy"
import { BusinessError } from "@/platform/policy"
import { importReportColumns } from "@/platform/imports/types"
export type CatalogImportColumn = { key: string; required?: boolean; help: string; options?: string[] }
export type CatalogImportProfile = {
  key: string; label: string; columns: CatalogImportColumn[]
  columnOverrides?: Record<string, Partial<CatalogImportColumn>>
  identify?: (tx: Prisma.TransactionClient, actor: BusinessActor, data: Record<string, unknown>) => Promise<{ keys: string[]; existing: boolean }>
  authorize: (tx: Prisma.TransactionClient, actor: BusinessActor) => Promise<void>
  extend: (tx: Prisma.TransactionClient, actor: BusinessActor, row: Record<string, string>) => Promise<Record<string, unknown>>
}
export const catalogImportColumns: CatalogImportColumn[] = [
  { key: "item_code", required: true, help: "Unique business-wide code; letters, numbers, dots, slashes or hyphens. Existing codes are skipped." },
  { key: "item_name", required: true, help: "Item display name." },
  { key: "kind", required: true, help: "PRODUCT for repeatable products; UNIT for individually identified inventory.", options: ["PRODUCT", "UNIT"] },
  { key: "sales_unit", required: true, help: "Quantity label, for example each, plot or apartment. Unit price is for one of these." },
  { key: "unit_price", help: "Optional price for one sales unit, excluding separately quoted charges. Leave blank if undecided (Price not set). Plain number, up to four decimals; no commas or currency symbols. Enter 0 only if intentionally free." },
  { key: "currency", help: "Leave blank to use the business currency in Settings, captured when uploading this file. Optionally override with a three-letter currency code, for example INR or USD." },
  { key: "availability", required: true, help: "AVAILABLE, UNAVAILABLE or SOLD (UNIT only). Booked/held stock without migrated agreements must be UNAVAILABLE; this does not create a booking.", options: ["AVAILABLE", "UNAVAILABLE", "SOLD"] },
  { key: "description", help: "Optional item description." },
]
export const basicCatalogImportProfile: CatalogImportProfile = { key: "catalog", label: "Products and units", columns: [], authorize: async () => {}, extend: async () => ({ extensionKey: null }) }
export const catalogImportTemplateVersion = 3
const chargeColumns: CatalogImportColumn[] = [
  { key: "charge_name", help: "Optional default item charge, for example PLC or Handling. One charge can be imported; additional charges can be edited on the item." },
  { key: "charge_calculation", help: "Required with charge_name: PERCENT or FIXED. Percentages use this item's quotation line price; fixed amounts apply once per line.", options: ["PERCENT", "FIXED"] },
  { key: "charge_value", help: "Required with charge_name. Enter 8 for 8%, not 0.08 or 8%. Plain number, up to four decimals; percentage 0 to 100." },
  { key: "charge_treatment", help: "Required with charge_name: INCLUDED adds to consideration and its instalments; EXTRA has separate payment conditions.", options: ["INCLUDED", "EXTRA"] },
  { key: "charge_due", help: "Optional payment conditions for the default charge." },
]
export const templateColumns = (profile: CatalogImportProfile) => [...catalogImportColumns.map(column => ({ ...column, ...profile.columnOverrides?.[column.key] })), ...profile.columns, ...chargeColumns]
export function checkTemplateHeaders(headers: string[], profile: CatalogImportProfile) {
  const expected = templateColumns(profile).map(column => column.key)
  const corrected = [...expected, ...importReportColumns]
  if (![expected, corrected].some(keys => keys.length === headers.length && keys.every((key, i) => headers[i] === key))) throw new BusinessError(400, "The columns do not match this template. Download a fresh template and keep its headings and column order unchanged.")
  return expected
}
export function catalogRowInput(row: Record<string, string>) {
  const hasCharge = chargeColumns.some(column => row[column.key])
  let charges: { label: string; kind: "FIXED" | "PERCENT"; value: string; included: boolean; due: string; group: string }[] = []
  if (hasCharge) {
    for (const key of ["charge_name", "charge_calculation", "charge_value", "charge_treatment"]) if (!row[key]) throw new BusinessError(400, `${key}: Required when an item charge is supplied.`)
    const kind = row.charge_calculation.toUpperCase(), treatment = row.charge_treatment.toUpperCase()
    if (kind !== "FIXED" && kind !== "PERCENT") throw new BusinessError(400, "charge_calculation: Choose FIXED or PERCENT.")
    if (!["INCLUDED", "EXTRA"].includes(treatment)) throw new BusinessError(400, "charge_treatment: Choose INCLUDED or EXTRA.")
    charges = [{ label: row.charge_name, kind, value: row.charge_value, included: treatment === "INCLUDED", due: row.charge_due || "", group: "" }]
  }
  return { code: row.item_code, name: row.item_name, kind: row.kind.toUpperCase(), unit: row.sales_unit, price: row.unit_price || null, currency: row.currency.toUpperCase(), availability: row.availability.toUpperCase(), description: row.description, charges, archived: false }
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
  instructions.addRow([`${profile.label} import - template v${catalogImportTemplateVersion}`])
  instructions.addRow(["Fill Items only. Keep headings unchanged. Delete unused blank rows. CSV exports of Items are also accepted."])
  instructions.addRow(["Up to 1,000 rows / 3 MB. No formulas. Validate before importing. Existing records are never updated."])
  instructions.addRow(["Projects, categories and launch phases must already exist and be accessible. No setup records are created by import."])
  instructions.addRow(["Field", "Required", "Instructions"])
  columns.forEach(column => instructions.addRow([column.key, column.required ? "Yes" : "No", column.help]))
  for (let row = 1; row <= 4; row++) { instructions.mergeCells(row, 1, row, 3); instructions.getRow(row).height = row === 1 ? 25 : 32 }
  instructions.eachRow(row => { row.alignment = { vertical: "top", wrapText: true } }); instructions.getRow(1).font = { bold: true }; instructions.getRow(5).font = { bold: true }
  return new Uint8Array(await book.xlsx.writeBuffer())
}
