import { createHash } from "node:crypto"
import { Prisma, type CustomFieldDefinition, type CustomFieldOption } from "@prisma/client"
import { BusinessError, type BusinessActor } from "@/platform/policy"
import { recordDomainAuditEvent } from "@/lib/domain-audit"
import type { FieldResource } from "./resources"
import type { FieldValue, FieldView } from "./validation"

type Tx = Prisma.TransactionClient
export type Definition = CustomFieldDefinition & { options: CustomFieldOption[] }
type ValueRow = { recordId: string; fieldId: string; scope: string; type: string; textValue: string | null; textKey: string | null; numberValue: Prisma.Decimal | null; dateValue: Date | null; booleanValue: boolean | null; optionId: string | null; fieldName: string; optionName: string | null }
export const managesFields = (actor: BusinessActor) => actor.role === "ADMIN" || actor.role === "MANAGER"
const textKey = (value: string) => createHash("sha256").update(value.toLowerCase()).digest("hex")
const table = (resource: FieldResource) => Prisma.raw(`"${resource.table}"`)
export const visibleField = (actor: BusinessActor, field: CustomFieldDefinition) => managesFields(actor) || field.visibility === "ALL"
export const editableField = (actor: BusinessActor, field: CustomFieldDefinition) => !field.archived && visibleField(actor, field) && (managesFields(actor) || field.editability === "ALL")
export async function definitions(tx: Tx, actor: BusinessActor, resource: FieldResource, includeHidden = false, salesTeamId?: string | null) {
  return tx.customFieldDefinition.findMany({ where: { tenantId: actor.tenantId, ...(salesTeamId !== undefined ? { OR: [{ salesTeamId: null }, { salesTeamId }] } : {}), scope: { in: [...resource.scopes] }, ...(!includeHidden && !managesFields(actor) ? { visibility: "ALL" } : {}) }, include: { options: { orderBy: [{ position: "asc" }, { id: "asc" }] } }, orderBy: [{ position: "asc" }, { id: "asc" }], take: 50 })
}
export function numberValue(value: unknown) {
  const text = String(value)
  if (!/^-?\d{1,18}(\.\d{1,6})?$/.test(text)) throw new BusinessError(400, "Use a number with at most 18 whole digits and 6 decimal places.")
  return new Prisma.Decimal(text)
}
export function validateFieldValue(field: Pick<Definition, "name" | "type" | "maxLength" | "minimum" | "maximum" | "options">, value: FieldValue): FieldValue {
  if (value === null || value === "") return null
  if (field.type === "TEXT") {
    if (typeof value !== "string" || value.length > field.maxLength) throw new BusinessError(400, `${field.name}: enter up to ${field.maxLength} characters.`)
    return value
  }
  if (field.type === "NUMBER") {
    if (typeof value !== "string" && typeof value !== "number") throw new BusinessError(400, `${field.name}: enter a number.`)
    const n = numberValue(value)
    if ((field.minimum !== null && n.lessThan(field.minimum)) || (field.maximum !== null && n.greaterThan(field.maximum))) throw new BusinessError(400, `${field.name}: number is outside the configured limits.`)
    return n.toFixed()
  }
  if (field.type === "DATE") {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value) throw new BusinessError(400, `${field.name}: enter a valid date.`)
    return value
  }
  if (field.type === "BOOLEAN") {
    if (typeof value !== "boolean") throw new BusinessError(400, `${field.name}: choose yes or no.`)
    return value
  }
  if (field.type === "SELECT" && typeof value === "string" && field.options.some(option => option.id === value && !option.archived)) return value
  throw new BusinessError(400, `${field.name}: choose an active option.`)
}
function valueOf(row?: ValueRow): FieldValue {
  if (!row) return null
  return row.textValue ?? row.numberValue?.toString() ?? row.dateValue?.toISOString().slice(0, 10) ?? row.booleanValue ?? row.optionId ?? null
}
export function fieldView(actor: BusinessActor, field: Definition, row?: ValueRow, createdAt?: Date, sharedCreatedAt?: Date | null): FieldView {
  const cohort = field.scope === "SALES" ? sharedCreatedAt ?? createdAt : createdAt
  return { salesTeamId: field.salesTeamId, id: field.id, scope: field.scope as FieldView["scope"], code: field.code, name: field.name, type: field.type as FieldView["type"], helpText: field.helpText,
    position: field.position, required: !field.archived && field.required && (!cohort || !field.requiredSince || cohort >= field.requiredSince), archived: field.archived,
    editable: editableField(actor, field), filterable: field.filterable, maxLength: field.maxLength, minimum: field.minimum?.toString() ?? null, maximum: field.maximum?.toString() ?? null,
    defaultValue: field.defaultValue as FieldValue, value: valueOf(row), savedName: row?.fieldName, optionName: row?.optionName,
    options: field.options.map(({ id, name, archived }) => ({ id, name, archived })),
  }
}
export async function readCustomFields(tx: Tx, actor: BusinessActor, resource: FieldResource, record: { id: string; createdAt: Date; customFieldsCreatedAt?: Date | null; salesTeamId?: string | null }) {
  const fields = await definitions(tx, actor, resource, false, record.salesTeamId ?? null)
  if (!fields.length) return []
  const rows = await tx.$queryRaw<ValueRow[]>(Prisma.sql`SELECT * FROM ${table(resource)} WHERE "tenantId"=${actor.tenantId} AND "recordId"=${record.id} AND "fieldId" IN (${Prisma.join(fields.map(field => field.id))})`)
  const byField = new Map(rows.map(row => [row.fieldId, row]))
  return fields.filter(field => !field.archived || byField.has(field.id)).map(field => fieldView(actor, field, byField.get(field.id), record.createdAt, record.customFieldsCreatedAt))
}

// Call only after the domain service authorizes the record. Writes share its transaction/version.
export async function saveCustomFields(tx: Tx, actor: BusinessActor, resource: FieldResource, record: { id: string; createdAt: Date; customFieldsCreatedAt?: Date | null; salesTeamId?: string | null }, patch: Record<string, FieldValue>, isNew = false, copied = false) {
  const fields = await definitions(tx, actor, resource, true, record.salesTeamId ?? null)
  const byId = new Map(fields.map(field => [field.id, field]))
  for (const id of Object.keys(patch)) {
    const field = byId.get(id)
    if (!field || !editableField(actor, field) || (copied && field.scope === "SALES")) throw new BusinessError(400, "A custom field cannot be changed. Refresh the record and check your access.")
  }
  if (!fields.length) return
  const rows = await tx.$queryRaw<ValueRow[]>(Prisma.sql`SELECT * FROM ${table(resource)} WHERE "tenantId"=${actor.tenantId} AND "recordId"=${record.id}`)
  const prior = new Map(rows.map(row => [row.fieldId, row]))
  const changes: { fieldId: string; before: FieldValue; after: FieldValue }[] = []
  for (const field of fields) {
    const old = prior.get(field.id), supplied = Object.hasOwn(patch, field.id)
    const useDefault = isNew && !old && !supplied && !field.archived && !(copied && field.scope === "SALES")
    let next = supplied ? patch[field.id] : useDefault ? field.defaultValue as FieldValue : valueOf(old)
    if (field.archived) continue
    // Unchanged values retain their saved labels and remain valid after tighter limits/option archive.
    if ((supplied || useDefault) && next !== valueOf(old)) next = validateFieldValue(field, next)
    const cohort = field.scope === "SALES" ? record.customFieldsCreatedAt ?? record.createdAt : record.createdAt
    if (field.required && (!field.requiredSince || cohort >= field.requiredSince) && (next === null || next === "")) throw new BusinessError(400, visibleField(actor, field) ? `${field.name} is required.` : "A required custom field needs a default. Ask your manager to update its configuration.")
    if ((!supplied && !useDefault) || next === valueOf(old) || (next === null && !old)) continue
    if (next === null) await tx.$executeRaw(Prisma.sql`DELETE FROM ${table(resource)} WHERE "tenantId"=${actor.tenantId} AND "recordId"=${record.id} AND "fieldId"=${field.id}`)
    else {
      const text = field.type === "TEXT" ? String(next) : null, number = field.type === "NUMBER" ? String(next) : null
      const date = field.type === "DATE" ? String(next) : null, bool = field.type === "BOOLEAN" ? next as boolean : null
      const optionId = field.type === "SELECT" ? String(next) : null, optionName = field.options.find(option => option.id === optionId)?.name ?? null
      await tx.$executeRaw(Prisma.sql`INSERT INTO ${table(resource)} ("tenantId","recordId","fieldId",scope,type,"textValue","textKey","numberValue","dateValue","booleanValue","optionId","fieldName","optionName") VALUES (${actor.tenantId},${record.id},${field.id},${field.scope},${field.type},${text},${text === null ? null : textKey(text)},${number}::numeric,${date}::date,${bool},${optionId},${field.name},${optionName}) ON CONFLICT ("tenantId","recordId","fieldId") DO UPDATE SET "textValue"=EXCLUDED."textValue","textKey"=EXCLUDED."textKey","numberValue"=EXCLUDED."numberValue","dateValue"=EXCLUDED."dateValue","booleanValue"=EXCLUDED."booleanValue","optionId"=EXCLUDED."optionId","fieldName"=EXCLUDED."fieldName","optionName"=EXCLUDED."optionName"`)
    }
    changes.push({ fieldId: field.id, before: valueOf(old), after: next })
  }
  if (changes.length) await recordDomainAuditEvent(tx, { tenantId: actor.tenantId, actorUserId: actor.userId, actorRole: actor.role, requestId: actor.requestId, event: "crm.customFields.updated", entityType: resource.key, entityId: record.id, after: changes as Prisma.InputJsonValue })
}

export async function copySharedFields(tx: Tx, actor: BusinessActor, from: FieldResource, to: FieldResource, sourceId: string, targetId: string) {
  await tx.$executeRaw(Prisma.sql`INSERT INTO ${table(to)} ("tenantId","recordId","fieldId",scope,type,"textValue","textKey","numberValue","dateValue","booleanValue","optionId","fieldName","optionName") SELECT "tenantId",${targetId},"fieldId",scope,type,"textValue","textKey","numberValue","dateValue","booleanValue","optionId","fieldName","optionName" FROM ${table(from)} WHERE "tenantId"=${actor.tenantId} AND "recordId"=${sourceId} AND scope='SALES'`)
}

export async function customFieldFilter(tx: Tx, actor: BusinessActor, resource: FieldResource, query: { customFieldId?: string; customFieldValue?: string; customFieldOperator?: string }) {
  if (!query.customFieldId) return {}
  const field = await tx.customFieldDefinition.findFirst({ where: { tenantId: actor.tenantId, id: query.customFieldId, scope: { in: [...resource.scopes] }, filterable: true } })
  if (!field || !visibleField(actor, field)) throw new BusinessError(400, "Custom field filter is unavailable.")
  const op = query.customFieldOperator || "eq", raw = query.customFieldValue
  if (raw === undefined || raw === "") throw new BusinessError(400, "Enter a custom field filter value.")
  if (op !== "eq" && !["NUMBER", "DATE"].includes(field.type)) throw new BusinessError(400, "Only numbers and dates support range filters.")
  const operation = op === "eq" ? "equals" : op
  let value: string | boolean | Date | Prisma.Decimal = raw
  const column = { TEXT: "textKey", NUMBER: "numberValue", DATE: "dateValue", BOOLEAN: "booleanValue", SELECT: "optionId" }[field.type]!
  if (field.type === "TEXT") value = textKey(raw)
  if (field.type === "NUMBER") value = numberValue(raw)
  if (field.type === "DATE") { validateFieldValue({ ...field, options: [] }, raw); value = new Date(raw) }
  if (field.type === "BOOLEAN") { if (!["true", "false"].includes(raw)) throw new BusinessError(400, "Choose yes or no."); value = raw === "true" }
  return { ...(field.salesTeamId ? { salesTeamId: field.salesTeamId } : {}), customFieldValues: { some: { tenantId: actor.tenantId, fieldId: field.id, [column]: { [operation]: value } } } }
}

// Exports receive only already-authorized records; definitions/values are fetched in batches, never per row.
export async function customFieldExport(tx: Tx, actor: BusinessActor, resource: FieldResource, ids: string[]) {
  const fields = await definitions(tx, actor, resource)
  if (ids.length * fields.length > 20000) throw new BusinessError(400, "This export exceeds 20,000 custom-field cells. Narrow the filters and try again.")
  const rows = ids.length && fields.length ? await tx.$queryRaw<ValueRow[]>(Prisma.sql`SELECT * FROM ${table(resource)} WHERE "tenantId"=${actor.tenantId} AND "recordId" IN (${Prisma.join(ids)}) AND "fieldId" IN (${Prisma.join(fields.map(field => field.id))})`) : []
  const teamByRecord = resource.scopes.includes("PROJECT") || !ids.length || !fields.some(field => field.salesTeamId) ? new Map<string, string | null>() : new Map((await tx.$queryRaw<{ id: string; salesTeamId: string | null }[]>(Prisma.sql`SELECT id, "salesTeamId" FROM ${Prisma.raw('"' + resource.table.replace('FieldValue', '') + '"')} WHERE "tenantId"=${actor.tenantId} AND id IN (${Prisma.join(ids)})`)).map(row => [row.id, row.salesTeamId]))
  const fieldTeams = new Map(fields.map(field => [field.id, field.salesTeamId]))
  const records = new Map<string, Map<string, ValueRow>>()
  for (const row of rows) { if (fieldTeams.get(row.fieldId) && fieldTeams.get(row.fieldId) !== teamByRecord.get(row.recordId)) continue; if (!records.has(row.recordId)) records.set(row.recordId, new Map()); records.get(row.recordId)!.set(row.fieldId, row) }
  return { headers: fields.map(field => `${field.name} [${field.scope.toLowerCase()}.${field.code}]`), values: Object.fromEntries(ids.map(id => [id, fields.map(field => { const row = records.get(id)?.get(field.id); return row?.optionName ?? valueOf(row) })])) }
}
