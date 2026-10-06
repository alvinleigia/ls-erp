import { parse } from "csv-parse/sync"
import ExcelJS from "exceljs"
import { Unzip, UnzipInflate } from "fflate"
import { CrmError } from "./policy"
import { IMPORT_MAX_BYTES, IMPORT_MAX_ROWS, type ImportIssue } from "./import-types"

export type ImportSheet = { headers: string[]; rows: { rowNumber: number; values: string[]; errors: ImportIssue[] }[] }

export async function parseImportFile(fileName: string, bytes: Uint8Array): Promise<ImportSheet> {
  if (!bytes.length || bytes.length > IMPORT_MAX_BYTES) throw new CrmError(400, "Choose a CSV or XLSX file up to 3 MB.")
  const sheet: ImportSheet = { headers: [], rows: [] }
  let textBytes = 0
  function add(values: string[], rowNumber: number, errors: ImportIssue[] = []) {
    if (values.every(v => !v.trim())) return
    if (values.length > 80 || values.some(v => v.length > 10000)) throw new CrmError(400, "Use at most 80 columns and 10,000 characters per cell.")
    textBytes += values.reduce((sum, value) => sum + Buffer.byteLength(value, "utf8"), 0)
    if (textBytes > 2 * 1024 * 1024) throw new CrmError(400, "This sheet contains too much text. Split it into smaller files.")
    if (!sheet.headers.length) {
      sheet.headers = values.map(v => v.trim())
      if (sheet.headers.some(v => !v) || new Set(sheet.headers.map(v => v.toLowerCase())).size !== sheet.headers.length) throw new CrmError(400, "Give every column a unique, non-empty heading.")
      return
    }
    if (values.length > sheet.headers.length) throw new CrmError(400, `Row ${rowNumber} has more cells than the header. Check its separators.`)
    if (sheet.rows.length >= IMPORT_MAX_ROWS) throw new CrmError(400, `Import up to ${IMPORT_MAX_ROWS} rows at a time.`)
    sheet.rows.push({ rowNumber, values: sheet.headers.map((_, i) => values[i] ?? ""), errors })
  }
  try {
    if (/\.csv$/i.test(fileName)) {
      const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes)
      parse(text, { bom: true, relax_column_count: true, skip_empty_lines: false, max_record_size: 800000, on_record: (record, context) => {
        add(record, context.records)
        return null
      } })
    } else if (/\.xlsx$/i.test(fileName)) {
      // Bound the expanded ZIP before ExcelJS parses XML/images/shared strings.
      let expanded = 0, entries = 0
      const zip = new Unzip(entry => {
        if (++entries > 500) throw new CrmError(400, "This workbook has too many parts. Export the enquiry sheet as CSV.")
        entry.ondata = (error, chunk) => {
          if (error) throw error
          expanded += chunk.length
          if (expanded > 20 * 1024 * 1024) throw new CrmError(400, "This workbook is too large. Export the enquiry sheet as CSV.")
        }
        entry.start()
      })
      zip.register(UnzipInflate)
      for (let offset = 0; offset < bytes.length; offset += 16384) zip.push(bytes.subarray(offset, offset + 16384), offset + 16384 >= bytes.length)
      const book = new ExcelJS.Workbook()
      await book.xlsx.load(bytes as unknown as ExcelJS.Buffer)
      const worksheet = book.worksheets[0]
      if (!worksheet) throw new CrmError(400, "The workbook has no sheets.")
      if (worksheet.rowCount > IMPORT_MAX_ROWS + 1 || worksheet.columnCount > 80) throw new CrmError(400, `Use at most ${IMPORT_MAX_ROWS} data rows and 80 columns on the first sheet.`)
      worksheet.eachRow((row, rowNumber) => {
        const errors: ImportIssue[] = [], values: string[] = []
        for (let i = 1; i <= row.cellCount; i++) {
          const cell = row.getCell(i)
          if (cell.type === ExcelJS.ValueType.Formula || cell.type === ExcelJS.ValueType.Error) errors.push({ field: sheet.headers[i - 1] || `Column ${i}`, message: "Replace formulas or Excel errors with plain values." })
          values.push(cell.value instanceof Date ? cell.value.toISOString().slice(0, 10) : cell.formula ? `=${cell.formula}` : cell.text)
        }
        add(values, rowNumber, errors)
      })
    } else throw new CrmError(400, "Choose a CSV or XLSX file. Save older XLS files as XLSX first.")
  } catch (error) {
    if (error instanceof CrmError) throw error
    throw new CrmError(400, "Unable to read this file. Use a UTF-8 CSV or an unprotected XLSX workbook with headings in the first row.")
  }
  if (!sheet.rows.length) throw new CrmError(400, "The sheet has no data rows.")
  return sheet
}
