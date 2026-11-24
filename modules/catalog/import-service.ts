import { isDeepStrictEqual } from "node:util"
import { recordDomainAuditEvent } from "@/lib/domain-audit"
import { Prisma } from "@prisma/client"
import { z } from "zod"
import { BusinessError, type BusinessActor } from "@/platform/policy"
import type { Requirement } from "@/platform/access/catalog"
import { spreadsheetCsv } from "@/platform/imports/csv"
import { importReportColumns, type ImportIssue } from "@/platform/imports/types"
import type { CatalogExtension } from "./contracts"
import { saveCatalogItem } from "./mutations"
import { catalogDefaultCurrency } from "./defaults"
import { catalogRowInput, catalogImportTemplateVersion, checkTemplateHeaders, templateColumns, catalogImportWorkbook, type CatalogImportProfile } from "./import-template"
type Tx = Prisma.TransactionClient
type Run = <T>(requirement: Requirement, operation: (tx: Tx, actor: BusinessActor) => Promise<T>, write?: boolean) => Promise<T>
const json = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value))
const querySchema = z.object({ page: z.coerce.number().int().min(1).max(100000).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(20) })
const fields: Record<string, string> = { code: "item_code", name: "item_name", unit: "sales_unit", price: "unit_price", unitNumber: "unit_number", companyCode: "unit_code", areaUnit: "area_unit", "extension.areaUnit": "area_unit", "extension.area": "area", "extension.bedrooms": "bedrooms" }
function rowIssues(error: unknown): ImportIssue[] {
  if (error instanceof z.ZodError) {
    const messages: Record<string, string> = { area: "Enter a positive area with up to four decimal places.", areaUnit: "Choose SQ_M or SQ_FT.", bedrooms: "Enter a whole number from 0 to 100.", currency: "Enter a valid three-letter currency code.", kind: "Use PRODUCT or UNIT.", availability: "Use AVAILABLE, UNAVAILABLE or SOLD." }
    const issues = error.issues.map(issue => ({ field: issue.path[0] === "charges" ? `charge_${issue.path.at(-1) === "label" ? "name" : String(issue.path.at(-1))}` : fields[issue.path.join(".")] || issue.path.join(".") || "Row", message: messages[String(issue.path.at(-1))] || issue.message }))
    return [...new Map(issues.map(issue => [`${issue.field}:${issue.message}`, issue])).values()]
  }
  if (error instanceof BusinessError && error.status === 400) return [{ field: "Row", message: error.message }]
  throw error
}
export function createCatalogImportService(run: Run, extensions: readonly CatalogExtension[], profiles: readonly CatalogImportProfile[]) {
  const owner = (actor: BusinessActor, id?: string) => ({ ...(id ? { id } : {}), tenantId: actor.tenantId, createdByUserId: actor.userId })
  async function profile(tx: Tx, actor: BusinessActor, key: string) {
    const entry = profiles.find(p => p.key === key)
    if (!entry) throw new BusinessError(400, "Choose a supported import template.")
    await entry.authorize(tx, actor)
    return entry
  }
  async function job(tx: Tx, actor: BusinessActor, id: string, processing = false) {
    const record = await tx.catalogImport.findFirst({ where: owner(actor, id) })
    if (!record) throw new BusinessError(404, "Import not found.")
    const selected = await profile(tx, actor, record.profile)
    if (processing) {
      if (record.templateVersion !== catalogImportTemplateVersion) throw new BusinessError(409, "Download the current template and upload remaining rows again. This earlier import remains available as read-only history.")
      checkTemplateHeaders(record.headers as string[], selected)
    }
    return record
  }
  async function progress(tx: Tx, actor: BusinessActor, id: string, status: string) {
    const counts = await tx.catalogImportRow.groupBy({ by: ["status"], where: { tenantId: actor.tenantId, importId: id }, _count: true })
    return { id, status, counts: Object.fromEntries(counts.map(c => [c.status, c._count])) }
  }
  async function input(tx: Tx, actor: BusinessActor, selected: CatalogImportProfile, values: string[], defaultCurrency: string | null) {
    const row = Object.fromEntries(templateColumns(selected).map((column, i) => [column.key, (values[i] || "").trim()]))
    for (const column of templateColumns(selected)) if (column.required && !row[column.key]) throw new BusinessError(400, `${column.key}: Required.`)
    if (!row.currency && !defaultCurrency) throw new BusinessError(400, "currency: Re-upload this row to capture the business currency, or enter an explicit currency in the new file.")
    row.currency ||= defaultCurrency || ""
    const data = { ...catalogRowInput(row), ...await selected.extend(tx, actor, row) }
    await saveCatalogItem(tx, actor, extensions, data, undefined, true)
    return data
  }
  return {
    catalogImportOptions() {
      return run("catalogItems.create", async (tx, actor) => {
        const items = []
        for (const selected of profiles) {
          try { await selected.authorize(tx, actor); items.push({ key: selected.key, label: selected.label }) }
          catch (error) { if (!(error instanceof BusinessError && error.status === 403)) throw error }
        }
        return { items }
      })
    },
    downloadCatalogImportTemplate(key: string) {
      return run("catalogItems.create", async (tx, actor) => {
        const selected = await profile(tx, actor, key)
        return { bytes: await catalogImportWorkbook(selected), name: `${selected.key}-import-template.xlsx` }
      })
    },
    async uploadCatalogImport(key: string, fileName: string, bytes: Uint8Array) {
      await run("catalogItems.create", (tx, actor) => profile(tx, actor, key))
      const { parseImportFile } = await import("@/platform/imports/file")
      const sheet = await parseImportFile(fileName, bytes)
      return run("catalogItems.create", async (tx, actor) => {
        const selected = await profile(tx, actor, key), columns = checkTemplateHeaders(sheet.headers, selected)
        const currencyIndex = columns.indexOf("currency")
        const defaultCurrency = sheet.rows.some(row => !(row.values[currencyIndex] || "").trim()) ? await catalogDefaultCurrency(tx, actor.tenantId) : null
        const record = await tx.catalogImport.create({ data: { tenantId: actor.tenantId, createdByUserId: actor.userId, profile: key, templateVersion: catalogImportTemplateVersion, fileName: fileName.slice(0, 200), headers: columns, defaultCurrency } })
        await tx.catalogImportRow.createMany({ data: sheet.rows.map(row => ({ tenantId: actor.tenantId, importId: record.id, rowNumber: row.rowNumber, values: row.values.slice(0, columns.length), status: row.errors.length ? "INVALID" : "PENDING", errors: json(row.errors) })) })
        await recordDomainAuditEvent(tx, { tenantId: actor.tenantId, actorUserId: actor.userId, actorRole: actor.role, requestId: actor.requestId, event: "catalog.import.uploaded", entityType: "CatalogImport", entityId: record.id, after: { profile: key, rows: sheet.rows.length } })
        return progress(tx, actor, record.id, record.status)
      }, true)
    },
    listCatalogImports(input: unknown) {
      const q = querySchema.parse(input)
      return run("catalogItems.create", async (tx, actor) => {
        const where = owner(actor)
        const [items, total] = await Promise.all([tx.catalogImport.findMany({ where, select: { id: true, profile: true, fileName: true, status: true, createdAt: true }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip: (q.page - 1) * q.pageSize, take: q.pageSize }), tx.catalogImport.count({ where })])
        return { items, total, page: q.page, pageSize: q.pageSize }
      })
    },
    getCatalogImport(id: string, input: unknown = {}) {
      const q = querySchema.parse(input)
      return run("catalogItems.create", async (tx, actor) => {
        const record = await job(tx, actor, id)
        const expected = templateColumns(profiles.find(p => p.key === record.profile)!).map(column => column.key)
        const headers = record.headers
        const canProcess = record.templateVersion === catalogImportTemplateVersion && Array.isArray(headers) && headers.length === expected.length && expected.every((key, index) => headers[index] === key)
        const [items, total, summary] = await Promise.all([
          tx.catalogImportRow.findMany({ where: { tenantId: actor.tenantId, importId: id }, select: { rowNumber: true, values: true, status: true, errors: true }, orderBy: { rowNumber: "asc" }, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
          tx.catalogImportRow.count({ where: { tenantId: actor.tenantId, importId: id } }), progress(tx, actor, id, record.status),
        ])
        return { ...record, ...summary, canProcess, items, total, page: q.page, pageSize: q.pageSize }
      })
    },
    processCatalogImport(id: string, action: "validate" | "import") {
      return run("catalogItems.create", async (tx, actor) => {
        const record = await job(tx, actor, id, true), selected = await profile(tx, actor, record.profile)
        if (record.status === "COMPLETE" || (action === "validate" && record.status !== "VALIDATING")) return progress(tx, actor, id, record.status)
        if (action === "import" && !["REVIEW", "IMPORTING"].includes(record.status)) throw new BusinessError(409, "Finish validating the file before importing.")
        const rows = await tx.catalogImportRow.findMany({ where: { tenantId: actor.tenantId, importId: id, status: action === "validate" ? "PENDING" : "READY" }, orderBy: { rowNumber: "asc" }, take: 25 })
        const started = Date.now()
        for (const row of rows) {
          const where = { tenantId_importId_rowNumber: { tenantId: actor.tenantId, importId: id, rowNumber: row.rowNumber } }
          let data: Record<string, unknown>
          try { data = await input(tx, actor, selected, row.values as string[], record.defaultCurrency) }
          catch (error) { await tx.catalogImportRow.update({ where, data: { status: "INVALID", errors: json(rowIssues(error)) } }); continue }
          const identity = selected.identify ? await selected.identify(tx, actor, data) : { keys: [String(data.code).toUpperCase()], existing: !!await tx.catalogItem.findFirst({ where: { tenantId: actor.tenantId, code: String(data.code).toUpperCase() }, select: { id: true } }) }
          const { keys: matchKeys, existing } = identity
          const prior = await tx.catalogImportRow.findFirst({ where: { tenantId: actor.tenantId, importId: id, rowNumber: { lt: row.rowNumber }, matchKeys: { hasSome: matchKeys }, status: { in: ["READY", "IMPORTED"] } }, select: { rowNumber: true } })
          if (existing || prior) {
            await tx.catalogImportRow.update({ where, data: { matchKeys, status: "DUPLICATE", errors: json([{ field: selected.identify ? "Row" : "item_code", message: prior ? `Duplicate of row ${prior.rowNumber}. Nothing was updated.` : "This code or unit number is already used in its context. Nothing was updated." }]) } })
          } else if (action === "validate") {
            await tx.catalogImportRow.update({ where, data: { matchKeys, input: json(data), status: "READY", errors: [] } })
          } else {
            if (!isDeepStrictEqual(data, row.input)) {
              await tx.catalogImportRow.update({ where, data: { status: "INVALID", errors: json([{ field: "Row", message: "A referenced setup record changed after validation. Re-upload this row using the current codes." }]) } })
              continue
            }
            // A late unique-code conflict is recoverable. Unexpected write/audit failures roll back this whole batch.
            await tx.$executeRawUnsafe("SAVEPOINT catalog_import_item")
            try {
              const item = await saveCatalogItem(tx, actor, extensions, data)
              await tx.catalogImportRow.update({ where, data: { status: "IMPORTED", itemId: item!.id, errors: [] } })
              await tx.$executeRawUnsafe("RELEASE SAVEPOINT catalog_import_item")
            } catch (error) {
              await tx.$executeRawUnsafe("ROLLBACK TO SAVEPOINT catalog_import_item")
              await tx.$executeRawUnsafe("RELEASE SAVEPOINT catalog_import_item")
              if ((error as { code?: string }).code !== "P2002") throw error
              await tx.catalogImportRow.update({ where, data: { status: "DUPLICATE", errors: json([{ field: "item_code", message: "This code is already used. Nothing was updated." }]) } })
            }
          }
          if (Date.now() - started >= 12000) break
        }
        const remaining = await tx.catalogImportRow.count({ where: { tenantId: actor.tenantId, importId: id, status: action === "validate" ? "PENDING" : "READY" } })
        const status = action === "validate" ? remaining ? "VALIDATING" : "REVIEW" : remaining ? "IMPORTING" : "COMPLETE"
        await tx.catalogImport.update({ where: { tenantId_id: { tenantId: actor.tenantId, id } }, data: { status } })
        return progress(tx, actor, id, status)
      }, true)
    },
    catalogImportCorrections(id: string) {
      return run("catalogItems.create", async (tx, actor) => {
        const record = await job(tx, actor, id)
        const rows = await tx.catalogImportRow.findMany({ where: { tenantId: actor.tenantId, importId: id, status: { in: ["INVALID", "DUPLICATE"] } }, select: { values: true, rowNumber: true, status: true, errors: true }, orderBy: { rowNumber: "asc" }, take: 1000 })
        return spreadsheetCsv([...(record.headers as string[]), ...importReportColumns], rows.map(row => [...row.values as string[], row.rowNumber, row.status, (row.errors as ImportIssue[]).map(issue => `${issue.field}: ${issue.message}`).join("; ")]))
      })
    },
  }
}
