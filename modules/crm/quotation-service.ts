import type { Prisma } from "@prisma/client"
import { CrmError, canManageCrm, enquiryScope, type CrmActor } from "./policy"
import { crmListSchema } from "./validation"
import { quotationSaveSchema, quotationTemplateSchema, emptyQuotationContent, type QuotationContent } from "./quotation-validation"
import { calculateQuotation, type QuotationCalculation } from "./quotation-calculation"
import type { CrmExtensions } from "./extensions"
import type { AppSettingsPayload } from "@/types/scheduling"

type Tx = Prisma.TransactionClient
type Context = {
  run: <T>(operation: (tx: Tx, actor: CrmActor) => Promise<T>) => Promise<T>
  audit: (tx: Tx, actor: CrmActor, event: string, id: string, before?: Prisma.InputJsonValue, after?: Prisma.InputJsonValue) => Promise<void>
}
export type QuotationSnapshot = {
  content: QuotationContent; calculation: QuotationCalculation;
  customer: { name: string; email: string | null; phone: string | null };
  opportunity: string; actor: string; template: { id: string; name: string; version: number } | null;
  context: { label: string; value: string }[]; locale: string; dateFormat: string;
  numberFormat: AppSettingsPayload["numberFormat"]; currencySymbolPlacement: AppSettingsPayload["currencySymbolPlacement"];
}
const json = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value))
const page = <T>(items: T[], total: number, q: { page: number; pageSize: number }) => ({ items, total, page: q.page, pageSize: q.pageSize, totalPages: Math.max(1, Math.ceil(total / q.pageSize)) })
function calculate(content: QuotationContent) { try { return calculateQuotation(content) } catch (error) { throw new CrmError(400, (error as Error).message) } }
export function createQuotationService({ run, audit }: Context, extensions: CrmExtensions) {
  const manage = (actor: CrmActor) => { if (!canManageCrm(actor.role)) throw new CrmError(403, "Only managers can configure quotation templates.") }
  async function opportunity(tx: Tx, actor: CrmActor, id: string) {
    const row = await tx.crmOpportunity.findFirst({ where: { ...enquiryScope(actor), id }, include: { contact: { select: { name: true, email: true, phone: true, archived: true } } } })
    if (!row) throw new CrmError(404, "Opportunity not found.")
    return row
  }
  async function find(tx: Tx, actor: CrmActor, id: string) {
    const row = await tx.crmQuotation.findFirst({ where: { tenantId: actor.tenantId, id, opportunity: enquiryScope(actor) } })
    if (!row) throw new CrmError(404, "Quotation not found.")
    return row
  }
  return {
    quotationDefaults(opportunityId: string) {
      return run(async (tx, actor) => {
        const row = await opportunity(tx, actor, opportunityId)
        const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: actor.tenantId }, select: { name: true } })
        const context = await extensions.quotationContext?.(tx, actor, row.id) || []
        return { opportunity: row.title, context, content: { ...emptyQuotationContent, supplierName: tenant.name, currency: row.currency, lines: [{ description: row.title, quantity: "1", unit: "", rate: row.amount.toString() }] } }
      })
    },
    listQuotationTemplates(input: unknown) {
      const q = crmListSchema.parse(input)
      return run(async (tx, actor) => {
        const where = { tenantId: actor.tenantId, archived: canManageCrm(actor.role) && q.archived === "true", name: { contains: q.q, mode: "insensitive" as const } }
        const [items, total] = await Promise.all([tx.crmQuotationTemplate.findMany({ where, select: { id: true, name: true, archived: true, version: true }, orderBy: [{ name: "asc" }, { id: "asc" }], skip: (q.page - 1) * q.pageSize, take: q.pageSize }), tx.crmQuotationTemplate.count({ where })])
        return { ...page(items, total, q), canManage: canManageCrm(actor.role) }
      })
    },
    getQuotationTemplate(id: string) {
      return run(async (tx, actor) => {
        const row = await tx.crmQuotationTemplate.findFirst({ where: { tenantId: actor.tenantId, id, ...(!canManageCrm(actor.role) ? { archived: false } : {}) } })
        if (!row) throw new CrmError(404, "Template not found.")
        return { ...row, canManage: canManageCrm(actor.role) }
      })
    },
    saveQuotationTemplate(input: unknown, id?: string) {
      const data = quotationTemplateSchema.parse(input)
      // Templates may have zero prices; evaluate the percentage schedule when used.
      if (data.content.bookingDate || data.content.validUntil) throw new CrmError(400, "Set dates on individual quotations, not on reusable templates.")
      return run(async (tx, actor) => {
        let recordId = id
        manage(actor)
        const before = id ? await tx.crmQuotationTemplate.findFirst({ where: { tenantId: actor.tenantId, id } }) : null
        if (id && !before) throw new CrmError(404, "Template not found.")
        const values = { name: data.name, content: json(data.content), archived: data.archived }
        if (before) {
          if (data.version !== before.version) throw new CrmError(409, "This template changed. Refresh before saving.")
          await tx.crmQuotationTemplate.updateMany({ where: { tenantId: actor.tenantId, id, version: before.version }, data: { ...values, version: { increment: 1 } } })
        } else { recordId = (await tx.crmQuotationTemplate.create({ data: { ...values, tenantId: actor.tenantId } })).id }
        await audit(tx, actor, "crm.quotationTemplate.saved", recordId!, before ? { version: before.version } : undefined, { name: data.name, archived: data.archived })
        return tx.crmQuotationTemplate.findUniqueOrThrow({ where: { tenantId_id: { tenantId: actor.tenantId, id: recordId! } } })
      })
    },
    listQuotations(opportunityId: string, input: unknown) {
      const q = crmListSchema.parse(input)
      return run(async (tx, actor) => {
        await opportunity(tx, actor, opportunityId)
        const where = { tenantId: actor.tenantId, opportunityId }
        const [items, total] = await Promise.all([tx.crmQuotation.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "asc" }], skip: (q.page - 1) * q.pageSize, take: q.pageSize }), tx.crmQuotation.count({ where })])
        return page(items, total, q)
      })
    },
    getQuotation(id: string, revision?: number) {
      return run(async (tx, actor) => {
        const row = await find(tx, actor, id)
        const item = await tx.crmQuotationRevision.findUnique({ where: { tenantId_quotationId_number: { tenantId: actor.tenantId, quotationId: id, number: revision ?? row.version } } })
        if (!item) throw new CrmError(404, "Quotation version not found.")
        return { ...row, revision: item.number, revisionCreatedAt: item.createdAt, snapshot: item.snapshot as unknown as QuotationSnapshot }
      })
    },
    saveQuotation(opportunityId: string, input: unknown, id?: string) {
      const data = quotationSaveSchema.parse(input), calculation = calculate(data.content)
      return run(async (tx, actor) => {
        let recordId = id
        const row = await opportunity(tx, actor, opportunityId)
        if (row.contact.archived) throw new CrmError(409, "Restore the contact before saving a new quotation version.")
        const before = id ? await find(tx, actor, id) : null
        if (before && before.opportunityId !== opportunityId) throw new CrmError(404, "Quotation not found.")
        if (before && data.version !== before.version) throw new CrmError(409, "This quotation changed. Refresh before saving.")
        const template = data.templateId ? await tx.crmQuotationTemplate.findFirst({ where: { tenantId: actor.tenantId, id: data.templateId, archived: false }, select: { id: true, name: true, version: true } }) : null
        if (data.templateId && !template) throw new CrmError(400, "Choose an active template.")
        const settings = await tx.appSetting.findUnique({ where: { tenantId: actor.tenantId }, select: { locale: true, dateFormat: true, numberFormat: true, currencySymbolPlacement: true } })
        const author = await tx.user.findFirstOrThrow({ where: { tenantId: actor.tenantId, id: actor.userId }, select: { name: true } })
        const context = await extensions.quotationContext?.(tx, actor, row.id) || []
        const snapshot: QuotationSnapshot = { content: data.content, calculation, context, customer: { name: row.contact.name, email: row.contact.email, phone: row.contact.phone }, opportunity: row.title, actor: author.name || "Staff", template, locale: settings?.locale || "en-US", dateFormat: settings?.dateFormat || "yyyy-MM-dd", numberFormat: settings?.numberFormat || "US_UK", currencySymbolPlacement: settings?.currencySymbolPlacement || "BEFORE" }
        const values = { title: data.content.title, currency: data.content.currency, consideration: calculation.consideration }
        if (before) await tx.crmQuotation.updateMany({ where: { tenantId: actor.tenantId, id, version: before.version }, data: { ...values, version: { increment: 1 } } })
        else recordId = (await tx.crmQuotation.create({ data: { ...values, tenantId: actor.tenantId, opportunityId } })).id
        const version = (before?.version || 0) + 1
        await tx.crmQuotationRevision.create({ data: { tenantId: actor.tenantId, quotationId: recordId!, number: version, snapshot: json(snapshot) } })
        await audit(tx, actor, "crm.quotation.saved", recordId!, before ? { version: before.version } : undefined, { version, opportunityId, consideration: calculation.consideration, currency: data.content.currency })
        await tx.crmOpportunityActivity.create({ data: { tenantId: actor.tenantId, opportunityId, actorUserId: actor.userId, event: "crm.quotation.saved", message: `${data.content.title}: version ${version} saved.` } })
        return { id: recordId, version }
      })
    },
  }
}
