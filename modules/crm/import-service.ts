import { peopleScope } from "@/platform/access/people-scope"
import { recordLimits } from "@/platform/access/rules"
import { termText } from "@/platform/terminology/message"
import type { TermReader } from "@/platform/terminology/read"
import { createTermResolver } from "@/platform/terminology/resolver"
import { importFieldLabel, importTemplateHeader } from "./import-labels"
import { Prisma } from "@prisma/client"
import { z } from "zod"
import { permits } from "@/platform/access/policy"
import { definitions, editableField } from "@/platform/custom-fields/values"
import type { FieldValue } from "@/platform/custom-fields/validation"
import type { CrmServiceContext } from "./service-context"
import type { CrmExtensions } from "./extensions"
import { CrmError, type CrmActor } from "./policy"
import { teamScope } from "@/platform/teams/service"
import { enquiryFields } from "./custom-fields"
import { crmListSchema } from "./validation"
import { baseImportFields, importReportColumns, suggestImportMapping, type ImportChoice, type ImportConfig, type ImportField, type ImportIssue, type ImportProgress } from "./import-types"
import { crmCsv } from "./csv"

type Tx = Prisma.TransactionClient
type Create = (tx: Tx, actor: CrmActor, input: unknown, validateOnly?: boolean, importId?: string) => Promise<{ id: string } | null>
const permission = ["enquiries.create", "contacts.create"] as const
const json = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value))
const configSchema = z.object({ mapping: z.record(z.string(), z.number().int().min(0).max(79)), defaults: z.record(z.string(), z.string().max(10000)) }).strict()
const rowKey = (tenantId: string, importId: string, rowNumber: number) => ({ tenantId_importId_rowNumber: { tenantId, importId, rowNumber } })
const contactKeys = ["name", "email", "phone", "addressLine1", "addressLine2", "city", "region", "postalCode", "country"]
const enquiryKeys = ["title", "requirements", "targetCloseOn", "assignedUserId", "salesTeamId", "sourceId"]
const clean = (s: string) => s.trim().toLowerCase()
const phoneText = (s: string) => s.trim().replace(/^'(?=\+)/, "").replace(/[\s().-]/g, "")
const batchSize = 25
const batchBudgetMs = 15000
class RowError extends CrmError {
  constructor(public issues: ImportIssue[], public duplicate = false) { super(400, issues.map(i => `${i.field}: ${i.message}`).join("; ")) }
}
function issues(error: unknown): ImportIssue[] {
  if (error instanceof RowError) return error.issues
  if (error instanceof z.ZodError) return error.issues.map(i => ({ field: i.path.filter(p => p !== "newContact").join(".") || "Row", message: i.message }))
  if (error instanceof CrmError && error.status < 500) return [{ field: "Row", message: error.message }]
  throw error // Infrastructure failures are retryable, never reported as bad customer data.
}

function inputReader(config: ImportConfig, fields: ImportField[], extensions: CrmExtensions) {
  const available = new Set(fields.map(f => f.key))
  const unavailable = [...Object.keys(config.mapping), ...Object.keys(config.defaults).filter(k => config.defaults[k])].some(k => !available.has(k))
  // Normalize each choice catalogue once per request, preserving ambiguous aliases
  // and parent-dependent choices. Saved records still use fresh domain checks.
  const readers = fields.map(field => {
    const choices = new Map<string, ImportChoice[]>()
    for (const choice of field.choices || []) {
      for (const key of new Set([choice.id, choice.name, ...(choice.aliases || [])].map(clean))) {
        const matches = choices.get(key)
        if (matches) matches.push(choice)
        else choices.set(key, [choice])
      }
    }
    return { field, choices }
  })
  return (values: string[]) => {
    const result: Record<string, unknown> = {}, errors: ImportIssue[] = []
    if (unavailable) throw new RowError([{ field: "Mapping", message: "A mapped field or module is no longer available. Restore access or upload the sheet again with updated mappings." }])
    for (const { field, choices: catalogue } of readers) {
      const column = config.mapping[field.key]
      const raw = (column === undefined ? "" : values[column] || "").trim() || config.defaults[field.key] || field.defaultValue || ""
      if (!raw) continue
      if (field.type === "choice") {
        const choices = (catalogue.get(clean(raw)) || []).filter(c => !field.dependsOn || (!!result[field.dependsOn] && c.parentId === result[field.dependsOn]))
        if (choices.length !== 1) errors.push({ field: field.label, message: choices.length ? "More than one match. Use the exact ID or unique code." : `No active matching choice for “${raw.slice(0, 100)}”. Check the spelling or select a default.` })
        else result[field.key] = choices[0].id
      } else if (field.type === "boolean") {
        if (!["yes", "no", "true", "false", "1", "0"].includes(clean(raw))) errors.push({ field: field.label, message: "Use Yes or No." })
        else result[field.key] = ["yes", "true", "1"].includes(clean(raw))
      } else if (field.type === "date") {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(raw) || !Number.isFinite(Date.parse(raw)) || new Date(raw).toISOString().slice(0, 10) !== raw) errors.push({ field: field.label, message: "Use a valid date in YYYY-MM-DD format." })
        else result[field.key] = raw
      } else result[field.key] = raw
    }
    result.email = clean(String(result.email || ""))
    result.phone = phoneText(String(result.phone || ""))
    if (!result.email && !result.phone) errors.push({ field: "Email / phone", message: "Provide an email address or an international phone number." })
    if (!result.name) errors.push({ field: "Contact name", message: "Enter a contact name." })
    if (!result.title) result.title = `Enquiry - ${result.name || ""}`
    if (errors.length) throw new RowError(errors)
    return {
      ...Object.fromEntries(enquiryKeys.filter(k => result[k] !== undefined).map(k => [k, result[k]])),
      newContact: Object.fromEntries(contactKeys.filter(k => result[k] !== undefined).map(k => [k, result[k]])),
      customFields: Object.fromEntries(fields.filter(f => f.key.startsWith("custom:") && result[f.key] !== undefined).map(f => [f.key.slice(7), result[f.key] as FieldValue])),
      ...extensions.importInput?.(result),
    }
  }
}

export function createEnquiryImportService({ run, audit, readTerms }: CrmServiceContext & { readTerms: TermReader }, extensions: CrmExtensions, create: Create) {
  const owner = (actor: CrmActor, id: string) => ({ id, tenantId: actor.tenantId, createdByUserId: actor.userId })
  async function batch(tx: Tx, actor: CrmActor, id: string) {
    const record = await tx.crmEnquiryImport.findFirst({ where: owner(actor, id) })
    if (!record) throw new CrmError(404, "Import not found.")
    return record
  }
  async function fields(tx: Tx, actor: CrmActor): Promise<ImportField[]> {
    const [users, sources, teams, custom, extension] = await Promise.all([
      tx.user.findMany({ where: { ...peopleScope(actor), ...(!permits(actor, "enquiries.assign") ? { id: actor.userId } : {}), status: "ACTIVE", role: { in: ["ADMIN", "MANAGER", "STAFF"] } }, select: { id: true, name: true, email: true }, orderBy: { name: "asc" }, take: 5000 }),
      tx.crmLeadSource.findMany({ where: { tenantId: actor.tenantId, archived: false }, select: { id: true, name: true }, orderBy: { name: "asc" }, take: 5000 }),
      tx.businessTeam.findMany({ where: { ...teamScope(actor), archived: false, workflow: { in: ["BOTH", "ENQUIRY_FIRST"] }, ...(recordLimits(actor, "enquiries", "create").includes("MANAGED_TEAMS") ? { id: { in: actor.managedTeamIds || [] } } : {}) }, select: { id: true, name: true }, orderBy: { name: "asc" }, take: 5000 }),
      definitions(tx, actor, enquiryFields), extensions.importFields?.(tx, actor) || [],
    ])
    return [
      ...baseImportFields,
      { key: "assignedUserId", label: "Salesperson", type: "choice", allowDefault: true, required: true, defaultValue: actor.userId, choices: users.map(u => ({ id: u.id, name: u.name || u.email, aliases: [u.email] })) },
      { key: "sourceId", label: "Source", type: "choice", allowDefault: true, choices: sources },
      { key: "salesTeamId", label: "Sales team", type: "choice", allowDefault: true, choices: teams },
      ...extension,
      ...custom.filter(f => editableField(actor, f)).map(f => ({ key: `custom:${f.id}`, customField: { name: f.name, scope: f.scope }, label: `${f.name} (${f.scope.toLowerCase()}${f.salesTeamId ? ", team field" : ""})`, aliases: [f.name, `${f.scope.toLowerCase()}.${f.code}`], type: f.type.toLowerCase() === "select" ? "choice" as const : f.type.toLowerCase() as ImportField["type"], required: f.required, salesTeamId: f.salesTeamId, choices: f.options.filter(o => !o.archived).map(o => ({ id: o.id, name: o.name })) })),
    ]
  }
  async function duplicate(tx: Tx, actor: CrmActor, id: string, rowNumber: number, email: string, phone: string) {
    if (!email && !phone) return
    const existing = await tx.$queryRaw<{ found: boolean }[]>(Prisma.sql`SELECT EXISTS(SELECT 1 FROM "CrmContact" WHERE "tenantId"=${actor.tenantId} AND ((${email} <> '' AND lower(email)=${email}) OR (${phone} <> '' AND phone=${phone}))) AS found`)
    if (existing[0]?.found) throw new RowError([{ field: "Email / phone", message: "Duplicate: a contact with this email or phone already exists in this business. Nothing was updated." }], true)
    const prior = await tx.crmEnquiryImportRow.findFirst({ where: { tenantId: actor.tenantId, importId: id, rowNumber: { lt: rowNumber }, OR: [...(email ? [{ email }] : []), ...(phone ? [{ phone }] : [])] }, select: { rowNumber: true }, orderBy: { rowNumber: "asc" } })
    if (prior) throw new RowError([{ field: "Email / phone", message: `Duplicate of row ${prior.rowNumber} in this file. Nothing was updated.` }], true)
  }
  async function get(id: string, input: unknown = {}) {
    const q = crmListSchema.extend({ result: z.enum(["all", "errors"]).default("all") }).parse(input)
    return run(permission, async (tx, actor) => {
      const record = await batch(tx, actor, id)
      const where = { tenantId: actor.tenantId, importId: id, ...(q.result === "errors" ? { status: { in: ["INVALID", "DUPLICATE"] } } : {}) }
      const [items, total, counts, catalog] = await Promise.all([
        tx.crmEnquiryImportRow.findMany({ where, orderBy: { rowNumber: "asc" }, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
        tx.crmEnquiryImportRow.count({ where }),
        tx.crmEnquiryImportRow.groupBy({ by: ["status"], where: { tenantId: actor.tenantId, importId: id }, _count: true }),
        record.status === "MAPPING" ? fields(tx, actor) : [],
      ])
      return { ...record, fields: catalog, items, total, page: q.page, pageSize: q.pageSize, totalPages: Math.max(1, Math.ceil(total / q.pageSize)), counts: Object.fromEntries(counts.map(c => [c.status, c._count])) }
    })
  }
  return {
    downloadEnquiryImportTemplate() {
      return run(permission, async (tx, actor) => {
        const catalog = await fields(tx, actor)
        // Custom-field codes distinguish similarly named fields and are already
        // recognized by the import mapper. No example rows become real leads.
        const term = createTermResolver(await readTerms(tx, actor))
        return crmCsv(catalog.map(field => importTemplateHeader(field, term)), [])
      })
    },
    getEnquiryImport: get,
    async uploadEnquiryImport(fileName: string, bytes: Uint8Array) {
      await run(permission, async () => undefined) // Reject unauthorized files before parsing.
      const { parseImportFile } = await import("./import-file")
      const sheet = await parseImportFile(fileName, bytes)
      const id = await run(permission, async (tx, actor) => {
        const catalog = await fields(tx, actor)
        const term = createTermResolver(await readTerms(tx, actor))
        const record = await tx.crmEnquiryImport.create({ data: { tenantId: actor.tenantId, createdByUserId: actor.userId, fileName: fileName.slice(0, 200), headers: sheet.headers,
          config: json({ mapping: suggestImportMapping(sheet.headers, catalog.map(field => ({ ...field, aliases: [...(field.aliases || []), importFieldLabel(field, term)] }))), defaults: {} }),
        } })
        await tx.crmEnquiryImportRow.createMany({ data: sheet.rows.map(row => ({ tenantId: actor.tenantId, importId: record.id, rowNumber: row.rowNumber, values: row.values, status: row.errors.length ? "INVALID" : "PENDING", errors: json(row.errors) })) })
        await audit(tx, actor, "crm.enquiry.import.uploaded", record.id, undefined, { fileName: record.fileName, rows: sheet.rows.length })
        return record.id
      })
      return get(id)
    },
    listEnquiryImports(input: unknown) {
      const q = crmListSchema.parse(input)
      return run(permission, async (tx, actor) => {
        const where = { tenantId: actor.tenantId, createdByUserId: actor.userId }
        const [items, total] = await Promise.all([tx.crmEnquiryImport.findMany({ where, select: { id: true, fileName: true, status: true, createdAt: true, _count: { select: { rows: true } } }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip: (q.page - 1) * q.pageSize, take: q.pageSize }), tx.crmEnquiryImport.count({ where })])
        return { items, total, page: q.page, pageSize: q.pageSize, totalPages: Math.max(1, Math.ceil(total / q.pageSize)) }
      })
    },
    async configureEnquiryImport(id: string, input: unknown) {
      const config = configSchema.parse(input)
      await run(permission, async (tx, actor) => {
        const record = await batch(tx, actor, id)
        if (record.status !== "MAPPING") throw new CrmError(409, "Mapping is already confirmed. Resume this import or upload a new sheet.")
        const headers = record.headers as string[], catalog = await fields(tx, actor), keys = new Set(catalog.map(f => f.key))
        if (Object.keys(config.mapping).some(k => !keys.has(k) || config.mapping[k] >= headers.length) || Object.keys(config.defaults).some(k => !keys.has(k))) throw new CrmError(400, "A mapped field is unavailable. Refresh and check module settings.")
        if (new Set(Object.values(config.mapping)).size !== Object.values(config.mapping).length) throw new CrmError(400, "Map each sheet column once.")
        if (config.mapping.name === undefined || (config.mapping.email === undefined && config.mapping.phone === undefined)) throw new CrmError(400, termText("crm.contact.singular", "Map Contact name and at least one of Email or Phone.", "Map {label} name and at least one of Email or Phone."))
        // Identity defaults could turn missing/invalid identities into duplicates.
        if (["name", "email", "phone"].some(k => config.defaults[k])) throw new CrmError(400, termText("crm.contact.singular", "Contact name, email and phone must come from the sheet.", "{label} name, email and phone must come from the sheet."))
        await tx.crmEnquiryImport.update({ where: { id, tenantId: actor.tenantId }, data: { config: json(config), status: "VALIDATING" } })
      })
      return get(id)
    },
    async processEnquiryImport(id: string, mode: "validate" | "import"): Promise<ImportProgress> {
      const deadline = performance.now() + batchBudgetMs
      const setup = await run(permission, async (tx, actor) => {
        const record = await batch(tx, actor, id)
        if (mode === "import" && record.status === "REVIEW") await tx.crmEnquiryImport.update({ where: { id, tenantId: actor.tenantId }, data: { status: "IMPORTING" } })
        else if (record.status !== (mode === "validate" ? "VALIDATING" : "IMPORTING")) {
          if (record.status === "COMPLETE" || (mode === "validate" && record.status === "REVIEW")) return null
          throw new CrmError(409, "Confirm mapping and finish validation before importing.")
        }
        const rows = await tx.crmEnquiryImportRow.findMany({ where: { tenantId: actor.tenantId, importId: id, status: mode === "validate" ? "PENDING" : "READY" }, select: { rowNumber: true }, orderBy: { rowNumber: "asc" }, take: batchSize })
        return { rows, readInput: inputReader(record.config as ImportConfig, await fields(tx, actor), extensions) }
      })
      let processed = 0
      for (const { rowNumber } of setup?.rows || []) {
        // Always attempt one row so even a slow setup can make durable progress.
        // Leave headroom under the route's 60-second limit; never interrupt a row.
        if (processed && performance.now() >= deadline) break
        let email = "", phone = "", authorized = false
        try {
          await run(permission, async (tx, actor) => {
            authorized = true
            const record = await batch(tx, actor, id)
            const row = await tx.crmEnquiryImportRow.findUniqueOrThrow({ where: rowKey(actor.tenantId, id, rowNumber) })
            if (row.status !== (mode === "validate" ? "PENDING" : "READY")) return
            const config = record.config as ImportConfig, values = row.values as string[]
            email = clean(values[config.mapping.email] || ""); phone = phoneText(values[config.mapping.phone] || "")
            await duplicate(tx, actor, id, rowNumber, email, phone)
            const input = setup!.readInput(values)
            const enquiry = await create(tx, actor, input, mode === "validate", record.id)
            await tx.crmEnquiryImportRow.update({ where: rowKey(actor.tenantId, id, rowNumber), data: { status: mode === "validate" ? "READY" : "IMPORTED", email: email || null, phone: phone || null, errors: [], ...(enquiry ? { enquiryId: enquiry.id } : {}) } })
          })
        } catch (error) {
          const detail = issues(error), isDuplicate = error instanceof RowError ? error.duplicate : error instanceof CrmError && error.status === 409 && error.message.includes("email or phone")
          // Permission loss or a serialization conflict stops processing; resume is safe.
          if (error instanceof CrmError && ((!authorized && error.status === 403) || (error.status === 409 && !isDuplicate))) throw error
          await run(permission, async (tx, actor) => {
            await batch(tx, actor, id)
            await tx.crmEnquiryImportRow.updateMany({ where: { tenantId: actor.tenantId, importId: id, rowNumber, status: mode === "validate" ? "PENDING" : "READY" }, data: { status: isDuplicate ? "DUPLICATE" : "INVALID", errors: json(detail), email: email || null, phone: phone || null } })
          })
        }
        processed++
      }
      return run(permission, async (tx, actor) => {
        const record = await batch(tx, actor, id)
        const grouped = await tx.crmEnquiryImportRow.groupBy({ by: ["status"], where: { tenantId: actor.tenantId, importId: id }, _count: true })
        const counts = Object.fromEntries(grouped.map(c => [c.status, c._count]))
        let status = record.status
        if (status === (mode === "validate" ? "VALIDATING" : "IMPORTING") && !counts[mode === "validate" ? "PENDING" : "READY"]) {
          status = mode === "validate" ? "REVIEW" : "COMPLETE"
          await tx.crmEnquiryImport.update({ where: { id, tenantId: actor.tenantId }, data: { status } })
          await audit(tx, actor, `crm.enquiry.import.${mode === "validate" ? "validated" : "completed"}`, id)
        }
        return { id, status, counts }
      })
    },
    downloadEnquiryImportErrors(id: string) {
      return run(permission, async (tx, actor) => {
        const record = await batch(tx, actor, id)
        if (!["REVIEW", "COMPLETE"].includes(record.status)) throw new CrmError(409, "Finish processing before downloading the correction sheet.")
        const rows = await tx.crmEnquiryImportRow.findMany({ where: { tenantId: actor.tenantId, importId: id, status: { in: ["INVALID", "DUPLICATE"] } }, orderBy: { rowNumber: "asc" } })
        const headers = record.headers as string[]
        // Replace our old report columns when a correction file is imported again.
        const keep = headers.map((h, i) => ({ h, i })).filter(c => !importReportColumns.includes(c.h))
        return crmCsv([...keep.map(c => c.h), ...importReportColumns], rows.map(row => [...keep.map(c => (row.values as string[])[c.i]), row.rowNumber, row.status, (row.errors as ImportIssue[]).map(e => `${e.field}: ${e.message}`).join("; ")]))
      })
    },
  }
}
