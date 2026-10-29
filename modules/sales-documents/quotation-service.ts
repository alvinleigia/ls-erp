import { recordActionAccess } from "@/platform/access/record-actions"
import { documentLayoutSchema } from "@/platform/documents/layout"
import { z } from "zod"
import { quotationLayoutSample } from "./quotation-layout-sample"
import { quotationRecordScope } from "@/platform/access/record-scope"
import { recordLimits } from "@/platform/access/rules"
import { termText } from "@/platform/terminology/message"
import { readDocumentBranding } from "@/platform/branding/read"
import type { DocumentBranding } from "@/platform/branding/types"
import { requireWriteFields, permits } from "@/platform/access/policy"
import type { Requirement } from "@/platform/access/catalog"
import { moduleEnabled } from "@/platform/modules"
import type { Prisma } from "@prisma/client"
import { BusinessError, type BusinessActor } from "@/platform/policy"
import { quotationListSchema, quotationSaveSchema, quotationTemplateSchema, emptyQuotationContent, type QuotationContent } from "./quotation-validation"
import { calculateQuotation, type QuotationCalculation } from "./quotation-calculation"
import type { QuotationDependencies, QuotationItemReference } from "./quotation-contracts"
import type { AppSettingsPayload } from "@/types/scheduling"
import { createTermResolver } from "@/platform/terminology/resolver"
import { quotationDocumentLabels, type QuotationDocumentLabels } from "./quotation-labels"
import { buildQuotationPdf } from "./quotation-pdf"
import { uploadQuotationPdf, removeUnusedPdf, type ArchivedPdf } from "@/platform/storage/documents"
import type { ParticipantSnapshot } from "@/platform/participants/validation"

type Tx = Prisma.TransactionClient
export type QuotationSnapshot = {
  participants?: ParticipantSnapshot;
  branding?: DocumentBranding | null;
  labels?: QuotationDocumentLabels;
  items?: QuotationItemReference[];
  content: QuotationContent; calculation: QuotationCalculation;
  customer: { name: string; email: string | null; phone: string | null };
  opportunity: string; actor: string; template: { id: string; name: string; version: number } | null;
  context: { label: string; value: string }[]; locale: string; dateFormat: string;
  numberFormat: AppSettingsPayload["numberFormat"]; currencySymbolPlacement: AppSettingsPayload["currencySymbolPlacement"];
}
const json = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value))
const page = <T>(items: T[], total: number, q: { page: number; pageSize: number }) => ({ items, total, page: q.page, pageSize: q.pageSize, totalPages: Math.max(1, Math.ceil(total / q.pageSize)) })
function calculate(content: QuotationContent) { try { return calculateQuotation(content) } catch (error) { throw new BusinessError(400, (error as Error).message) } }
const activeTemplatesOnly = (actor: BusinessActor) => recordLimits(actor, "quotationTemplates").includes("ACTIVE")
export function createQuotationService({ run: checkedRun, audit, opportunityScope, documentContext, readTerms, resolveItems, participants }: QuotationDependencies) {
  function run<T>(requirement: Requirement, operation: (tx: Tx, actor: BusinessActor, paymentPlans: boolean) => Promise<T>) {
    return checkedRun(requirement, async (tx, actor) => {
      const flags = await tx.tenantModule.findMany({ where: { tenantId: actor.tenantId } })
      if (!moduleEnabled(flags, "salesDocuments")) throw new BusinessError(403, "Sales Documents is not enabled for this business.")
      return operation(tx, actor, moduleEnabled(flags, "paymentPlans"))
    })
  }
  function assertScheduleWrite(enabled: boolean, content: QuotationContent, previous?: QuotationContent) {
    if (!enabled && (content.instalments.length || previous?.instalments.length)) throw new BusinessError(403, "Enable Payment Plans before saving a document or template with an instalment schedule. Saved versions remain available.")
  }
  async function opportunity(tx: Tx, actor: BusinessActor, id: string) {
    const row = await tx.crmOpportunity.findFirst({ where: { ...opportunityScope(actor), id }, select: { id: true, title: true, currency: true, amount: true, participantInformation: true, contact: { select: { id: true, tenantId: true, name: true, email: true, phone: true, archived: true, version: true } }, account: { select: { id: true, tenantId: true, name: true, version: true } } } })
    if (!row) throw new BusinessError(404, termText("crm.opportunity.singular", "Opportunity not found.", "{label} not found."))
    return row
  }
  async function find(tx: Tx, actor: BusinessActor, id: string) {
    const row = await tx.crmQuotation.findFirst({ where: { ...quotationRecordScope(actor), id } })
    if (!row) throw new BusinessError(404, termText("salesDocuments.quotation.singular", "Quotation not found.", "{label} not found."))
    return row
  }
  return {
    async previewQuotationLayout(input:unknown){
      const {layout}=z.object({layout:documentLayoutSchema}).strict().parse(input)
      const paymentPlans=await run({any:["quotationTemplates.create","quotationTemplates.edit","quotations.create","quotations.edit"]},async(_tx,_actor,paymentPlans)=>paymentPlans)
      return buildQuotationPdf({id:"SAMPLE",revision:1,revisionCreatedAt:"2026-01-01",snapshot:quotationLayoutSample(layout,paymentPlans)},true)
    },
    quotationDefaults(opportunityId: string) {
      return run("quotations.create", async (tx, actor, paymentPlans) => {
        const row = await opportunity(tx, actor, opportunityId)
        const tenant = await readDocumentBranding(tx, actor.tenantId)
        const term = createTermResolver(await readTerms?.(tx, actor) || {})
        const context = await documentContext?.(tx, actor, row.id, term) || []
        return { paymentPlansEnabled: paymentPlans, opportunity: row.title, context, content: { ...emptyQuotationContent, title: term("salesDocuments.quotation.singular", emptyQuotationContent.title), supplierName: tenant.name, currency: row.currency, lines: [{ description: row.title, quantity: "1", unit: "", rate: row.amount.toString() }] } }
      })
    },
    listQuotationTemplates(input: unknown) {
      const q = quotationListSchema.parse(input)
      return run("quotationTemplates.read", async (tx, actor, paymentPlans) => {
        const where = { tenantId: actor.tenantId, archived: q.archived === "true", ...(activeTemplatesOnly(actor) ? { AND: [{ archived: false }] } : {}), name: { contains: q.q, mode: "insensitive" as const } }
        const [items, total] = await Promise.all([tx.crmQuotationTemplate.findMany({ where, select: { id: true, name: true, archived: true, version: true }, orderBy: [{ name: "asc" }, { id: "asc" }], skip: (q.page - 1) * q.pageSize, take: q.pageSize }), tx.crmQuotationTemplate.count({ where })])
        return { ...page(items, total, q), canManage: permits(actor, "quotationTemplates.edit"), paymentPlansEnabled: paymentPlans }
      })
    },
    getQuotationTemplate(id: string) {
      return run("quotationTemplates.read", async (tx, actor, paymentPlans) => {
        const row = await tx.crmQuotationTemplate.findFirst({ where: { tenantId: actor.tenantId, id, ...(activeTemplatesOnly(actor) ? { archived: false } : {}) } })
        if (!row) throw new BusinessError(404, "Template not found.")
        return { ...row, canManage: permits(actor, "quotationTemplates.edit"), paymentPlansEnabled: paymentPlans }
      })
    },
    saveQuotationTemplate(input: unknown, id?: string) {
      const data = quotationTemplateSchema.parse(input)
      if (data.content.lines.some(line => line.catalogItemId)) throw new BusinessError(400, "Select catalog items on individual quotations, not reusable templates.")
      // Templates may have zero prices; evaluate the percentage schedule when used.
      if (data.content.bookingDate || data.content.validUntil) throw new BusinessError(400, termText("salesDocuments.quotation.plural", "Set dates on individual quotations, not on reusable templates.", "Set dates on individual {label}, not on reusable templates."))
      return run(id ? "quotationTemplates.edit" : "quotationTemplates.create", async (tx, actor, paymentPlans) => {
        let recordId = id
        const before = id ? await tx.crmQuotationTemplate.findFirst({ where: { tenantId: actor.tenantId, id, ...(activeTemplatesOnly(actor) ? { archived: false } : {}) } }) : null
        requireWriteFields(actor, "quotationTemplates", before ?? undefined, data)
        if (id && !before) throw new BusinessError(404, "Template not found.")
        assertScheduleWrite(paymentPlans, data.content, before?.content as QuotationContent | undefined)
        const values = { name: data.name, content: json(data.content), archived: data.archived }
        if (before) {
          if (data.version !== before.version) throw new BusinessError(409, "This template changed. Refresh before saving.")
          await tx.crmQuotationTemplate.updateMany({ where: { tenantId: actor.tenantId, id, version: before.version }, data: { ...values, version: { increment: 1 } } })
        } else { recordId = (await tx.crmQuotationTemplate.create({ data: { ...values, tenantId: actor.tenantId } })).id }
        await audit(tx, actor, "crm.quotationTemplate.saved", recordId!, before ? { version: before.version } : undefined, { name: data.name, archived: data.archived })
        return tx.crmQuotationTemplate.findUniqueOrThrow({ where: { tenantId_id: { tenantId: actor.tenantId, id: recordId! } } })
      })
    },
    listQuotations(opportunityId: string | undefined, input: unknown) {
      const q = quotationListSchema.parse(input)
      return run("quotations.read", async (tx, actor, paymentPlans) => {
        if (opportunityId) await opportunity(tx, actor, opportunityId)
        const where = { tenantId: actor.tenantId, ...(opportunityId ? { opportunityId } : {}), ...quotationRecordScope(actor), title: { contains: q.q, mode: "insensitive" as const } }
        const [items, total] = await Promise.all([tx.crmQuotation.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "asc" }], skip: (q.page - 1) * q.pageSize, take: q.pageSize }), tx.crmQuotation.count({ where })])
        return { ...page(items, total, q), paymentPlansEnabled: paymentPlans }
      })
    },
    getQuotation(id: string, revision?: number, exporting = false) {
      return run(exporting ? ["quotations.read", "quotations.export"] : "quotations.read", async (tx, actor, paymentPlans) => {
        const row = await find(tx, actor, id)
        const item = await tx.crmQuotationRevision.findUnique({ where: { tenantId_quotationId_number: { tenantId: actor.tenantId, quotationId: id, number: revision ?? row.version } } })
        if (!item) throw new BusinessError(404, termText("salesDocuments.quotation.singular", "Quotation version not found.", "{label} version not found."))
        return { ...row, recordAccess: await recordActionAccess(actor, "quotations", id, tx, async action => !!await tx.crmQuotation.findFirst({ where: { ...quotationRecordScope(actor, action), id }, select: { id: true } })), revision: item.number, revisionCreatedAt: item.createdAt, snapshot: item.snapshot as unknown as QuotationSnapshot, archivedPdf: item.archivedPdf as ArchivedPdf | null, paymentPlansEnabled: paymentPlans }
      })
    },
    async issueQuotation(id: string, revision: number) {
      const requirement: Requirement = ["quotations.read", "quotations.edit", "quotations.export"]
      const prepared = await run(requirement, async (tx, actor) => {
        const row = await find(tx, actor, id)
        const item = await tx.crmQuotationRevision.findUnique({ where: { tenantId_quotationId_number: { tenantId: actor.tenantId, quotationId: id, number: revision } } })
        if (!item) throw new BusinessError(404, "Quotation version not found.")
        return { ...row, revision, revisionCreatedAt: item.createdAt, snapshot: item.snapshot as unknown as QuotationSnapshot, archivedPdf: item.archivedPdf as ArchivedPdf | null }
      })
      if (prepared.archivedPdf) return prepared.archivedPdf
      // Rendering and storage IO stay outside database transactions. A concurrent
      // issuer may upload a candidate too; only one archive is committed.
      const candidate = await uploadQuotationPdf(prepared.tenantId, id, revision, await buildQuotationPdf(prepared))
      let archived: ArchivedPdf
      try {
        archived = await run(requirement, async (tx, actor) => {
          await find(tx, actor, id)
          await tx.$queryRaw`SELECT number FROM "CrmQuotationRevision" WHERE "tenantId"=${actor.tenantId} AND "quotationId"=${id} AND number=${revision} FOR UPDATE`
          const where = { tenantId_quotationId_number: { tenantId: actor.tenantId, quotationId: id, number: revision } }
          const current = await tx.crmQuotationRevision.findUniqueOrThrow({ where })
          if (current.archivedPdf) return current.archivedPdf as ArchivedPdf
          const archive: ArchivedPdf = { ...candidate, issuedAt: new Date().toISOString(), issuedBy: actor.userId }
          await tx.crmQuotationRevision.update({ where, data: { archivedPdf: json(archive) } })
          await audit(tx, actor, "crm.quotation.issued", id, undefined, { revision, ...archive })
          return archive
        })
      } catch (error) {
        // Retain the candidate on an ambiguous commit failure; retry reads the
        // committed archive instead of replacing an issued document.
        if (error instanceof BusinessError) await removeUnusedPdf(candidate.path).catch(() => {})
        throw error
      }
      if (archived.path !== candidate.path) await removeUnusedPdf(candidate.path).catch(() => {})
      return archived
    },
    saveQuotation(opportunityId: string, input: unknown, id?: string) {
      const data = quotationSaveSchema.parse(input)
      const acceptedContent={...data.content,lines:data.content.lines.map(line=>{const copy={...line};delete copy.refreshCatalogItem;return copy})},calculation=calculate(acceptedContent)
      return run(id ? "quotations.edit" : "quotations.create", async (tx, actor, paymentPlans) => {
        let recordId = id
        const row = await opportunity(tx, actor, opportunityId)
        if (row.contact.archived) throw new BusinessError(409, ["Restore the ", termText("crm.contact.singular", "contact"), " before saving a new ", termText("salesDocuments.quotation.singular", "quotation"), " version."])
        const before = id ? await find(tx, actor, id) : null
        if (before && before.opportunityId !== opportunityId) throw new BusinessError(404, termText("salesDocuments.quotation.singular", "Quotation not found.", "{label} not found."))
        if (before && data.version !== before.version) throw new BusinessError(409, termText("salesDocuments.quotation.singular", "This quotation changed. Refresh before saving.", "This {label} changed. Refresh before saving."))
        const prior = before ? await tx.crmQuotationRevision.findUniqueOrThrow({ where: { tenantId_quotationId_number: { tenantId: actor.tenantId, quotationId: before.id, number: before.version } } }) : null
        if (!resolveItems && data.content.lines.some(line => line.catalogItemId)) throw new BusinessError(400, "Catalog selection is not available.")
        const items = await resolveItems?.(tx, actor, data.content, prior ? (prior.snapshot as unknown as QuotationSnapshot).items || [] : []) || []
        assertScheduleWrite(paymentPlans, data.content, prior ? (prior.snapshot as unknown as QuotationSnapshot).content : undefined)
        const template = data.templateId ? await tx.crmQuotationTemplate.findFirst({ where: { tenantId: actor.tenantId, id: data.templateId, archived: false }, select: { id: true, name: true, version: true } }) : null
        if (data.templateId && !template) throw new BusinessError(400, "Choose an active template.")
        const settings = await tx.appSetting.findUnique({ where: { tenantId: actor.tenantId }, select: { locale: true, dateFormat: true, numberFormat: true, currencySymbolPlacement: true } })
        const author = await tx.user.findFirstOrThrow({ where: { tenantId: actor.tenantId, id: actor.userId }, select: { name: true } })
        const term = createTermResolver(await readTerms?.(tx, actor) || {})
        const context = await documentContext?.(tx, actor, row.id, term) || []
        const snapshot: QuotationSnapshot = { labels: quotationDocumentLabels(term), content: acceptedContent, calculation, context, customer: { name: row.contact.name, email: row.contact.email, phone: row.contact.phone }, opportunity: row.title, actor: author.name || "Staff", template, locale: settings?.locale || "en-US", dateFormat: settings?.dateFormat || "yyyy-MM-dd", numberFormat: settings?.numberFormat || "US_UK", currencySymbolPlacement: settings?.currencySymbolPlacement || "BEFORE" }
        snapshot.items = items
        // Capture all customer facts from this one scoped source read. A second
        // lookup could mix two identities if the source is reassigned meanwhile.
        if (participants) snapshot.participants = await participants(tx, actor, opportunityId, { tenantId: actor.tenantId, person: row.contact, business: row.account, information: row.participantInformation })
        snapshot.branding = prior ? (prior.snapshot as unknown as QuotationSnapshot).branding || null : await readDocumentBranding(tx, actor.tenantId)
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
