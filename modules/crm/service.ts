import { requireWriteFields, permits, requirePermission } from "@/platform/access/policy"
import type { Requirement } from "@/platform/access/catalog"
import { findAccessUser, assignedPermissions } from "@/platform/access/server"
import { workspaceRead } from "@/platform/access/catalog"
import type { CrmServiceContext } from "./service-context"
import { createPresetService, type CrmPreset } from "./preset-service"
import { createTeamService, resolveSalesTeam, teamSelect } from "./team-service"
import { constraintTarget, serializationConflict } from "./database-errors"
import { splitCustomFields } from "@/platform/custom-fields/validation"
import { readCustomFields, saveCustomFields, customFieldFilter, customFieldExport } from "@/platform/custom-fields/values"
import { enquiryFields } from "./custom-fields"
import { createLostReasonService, resolveLostReason } from "./lost-reason-service"
import { createSalesReportService } from "./sales-report-service"
import { checkExportLimit, CRM_EXPORT_LIMIT } from "./csv"
import type { Prisma, PrismaClient, Role } from "@prisma/client"
import { recordDomainAuditEvent } from "@/lib/domain-audit"
import { createSalesService } from "./sales-service"
import { createActivityTypeService } from "./activity-type-service"
import { createWorkService } from "./work-service"
import { createReportService } from "./report-service"
import { createFollowUpService } from "./follow-up-service"
import { createIntakeService, enquiryContext, maskReferrals, referralInclude } from "./intake-service"
import { noCrmExtensions, type CrmExtensions } from "./extensions"
import { CrmError, canManageCrm, canUseCrm, contactScope, accountScope, enquiryScope, assigneeScope, type CrmActor } from "./policy"
import {
  crmContactSchema, crmContactUpdateSchema, crmEnquiryCreateSchema,
  crmEnquiryUpdateSchema, crmListSchema, crmNoteSchema, crmTaskSchema,
  crmAccountSchema, crmAccountUpdateSchema, crmAccountLinkSchema,
} from "./validation"

const personSelect = { id: true, name: true } as const
const contactSelect = { id: true, name: true, email: true, phone: true, archived: true } as const
const enquiryInclude = { salesTeam: { select: teamSelect }, contact: { select: contactSelect }, assignee: { select: personSelect }, account: { select: { id: true, name: true } }, leadSource: { select: { id: true, name: true, archived: true } }, ...referralInclude } as const
const snapshot = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value))
type Tx = Prisma.TransactionClient

function pageResult<T>(items: T[], total: number, page: number, pageSize: number) {
  return { items, total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)) }
}

// No HTTP or Lia dependencies. Every operation checks current membership and
// module access, then runs in a transaction. Caller must establish DB tenant context.
export function createCrmService<Fields extends object = object, Metadata extends object = object, Addons extends object = object>(db: PrismaClient, identity: Pick<CrmActor, "tenantId" | "userId" | "requestId">, extensions: CrmExtensions<Fields, Metadata> = noCrmExtensions as CrmExtensions<Fields, Metadata>, presets: readonly CrmPreset[] = [], install?: (context: CrmServiceContext) => Addons) {
  async function run<T>(requirement: Requirement, operation: (tx: Tx, actor: CrmActor) => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      try {
        // A page loads several CRM panels concurrently through the small tenant
        // pool. Allow bounded queueing beyond Prisma's two-second default while
        // retaining the execution limit for up to 12 audited plan activities.
        return await db.$transaction(async tx => {
          const user = await findAccessUser(tx, identity.tenantId, identity.userId)
          const platformSlug = process.env.PLATFORM_ADMIN_TENANT_SLUG?.trim().toLowerCase() || "platform"
          if (!user || !canUseCrm(user.role) || user.tenant?.status !== "ACTIVE" || user.tenant.slug === platformSlug) {
            throw new CrmError(403, "CRM access is not permitted.")
          }
          const enabledModule = await tx.tenantModule.findUnique({
            where: { tenantId_key: { tenantId: identity.tenantId, key: "crm" } },
          })
          if (!enabledModule?.allowed || !enabledModule.enabled) throw new CrmError(403, "CRM is not enabled for this business.")
          const actor = { ...identity, role: user.role, permissions: assignedPermissions(user), crmRecordScope: user.crmRecordScope, managedTeamIds: user.managedTeamIds }; requirePermission(actor, requirement)
          return operation(tx, actor)
        }, { isolationLevel: "Serializable", maxWait: 20000, timeout: 20000 })
      } catch (error) {
        const code = (error as { code?: string })?.code
        if (serializationConflict(error) && attempt < 2) continue
        if (code === "P2002") {
          // The PostgreSQL driver adapter reports constraint fields in its
          // nested cause rather than Prisma's legacy meta.target location.
          const target = constraintTarget(error)
          if (target.includes("nameKey")) throw new CrmError(409, "A choice with this name already exists. Edit or restore it.")
          if (target.includes("sourceType") && target.includes("outcome")) throw new CrmError(409, "A rule for this activity type and outcome already exists. Edit or restore that rule.")
          if (target.includes("requestKey")) { if (attempt < 2) continue; throw new CrmError(409, "This plan application is being processed. Retry to see its activities.") }
          if (target.includes("followUpOfId")) throw new CrmError(409, "A next follow-up was already scheduled. Refresh to see it.")
          // A competing conversion may win the unique enquiry link before this
          // transaction commits. Retry to return the authorized existing deal.
          if (target.includes("enquiryId") && attempt < 2) continue
          throw new CrmError(409, target.includes("enquiryId") ? "This enquiry already has an opportunity. Refresh to open it." : "A contact with this email or phone already exists in this business. Ask your manager if you cannot find it.")
        }
        if (serializationConflict(error)) throw new CrmError(409, "This record changed. Refresh and try again.")
        throw error
      }
    }
  }

  async function audit(tx: Tx, actor: CrmActor, event: string, entityId: string, before?: Prisma.InputJsonValue, after?: Prisma.InputJsonValue) {
    await recordDomainAuditEvent(tx, {
      tenantId: actor.tenantId, actorUserId: actor.userId, actorRole: actor.role as Role,
      requestId: actor.requestId, event, entityType: event.startsWith("crm.quotationTemplate.") ? "CrmQuotationTemplate" : event.startsWith("crm.quotation.") ? "CrmQuotation" : event.startsWith("crm.preset.") ? "CrmPreset" : event.startsWith("crm.team.") ? "CrmSalesTeam" : event.startsWith("crm.activityType.") ? "CrmActivityType" : event.startsWith("crm.lostReason.") ? "CrmLostReason" : event.startsWith("crm.source.") ? "CrmLeadSource" : event.startsWith("crm.rule.") ? "CrmFollowUpRule" : event.startsWith("crm.plan.") ? "CrmActivityPlan" : event.startsWith("crm.work") ? "CrmTask" : event.startsWith("crm.opportunity") ? "CrmOpportunity" : event.startsWith("crm.pipeline") ? "CrmPipeline" : event.startsWith("crm.account") ? "CrmAccount" : event.startsWith("crm.contact") ? "CrmContact" : "CrmEnquiry",
      entityId, before, after,
    })
  }

  async function activity(tx: Tx, actor: CrmActor, enquiryId: string, event: string, message: string) {
    await tx.crmActivity.create({ data: { tenantId: actor.tenantId, enquiryId, actorUserId: actor.userId, event, message } })
  }

  async function findEnquiry(tx: Tx, actor: CrmActor, id: string) {
    const enquiry = await tx.crmEnquiry.findFirst({ where: { ...enquiryScope(actor), id }, include: enquiryInclude })
    if (!enquiry) throw new CrmError(404, "Enquiry not found.")
    return enquiry
  }

  // Existing IDs come only from a scoped record lookup; preserve ownership on edits.
  async function checkAssignee(tx: Tx, actor: CrmActor, assignedUserId: string, existingAssigneeId?: string) {
    if (!canManageCrm(actor.role) && assignedUserId !== actor.userId) throw new CrmError(403, "Only a manager can assign another salesperson.")
    const assignee = await tx.user.findFirst({
      where: { ...(existingAssigneeId === assignedUserId ? { tenantId: actor.tenantId } : assigneeScope(actor)), id: assignedUserId, status: "ACTIVE", role: { in: ["ADMIN", "MANAGER", "STAFF"] } },
      select: { id: true },
    })
    if (!assignee) throw new CrmError(400, "Choose an active salesperson in this business.")
  }

  return {
    ...(install ? install({ run, audit }) : {} as Addons),
    listExtensionChoices(key: string, input: unknown) { return run(workspaceRead, (tx, actor) => extensions.choices(tx, actor, key, input)) },
    ...createSalesService({ run, audit, checkAssignee }, extensions),
    ...createActivityTypeService({ run, audit }),
    ...createWorkService({ run, audit, checkAssignee }, extensions),
    ...createReportService({ run }),
    ...createSalesReportService({ run }, extensions),
    ...createFollowUpService({ run, audit }),
    ...createIntakeService({ run, audit }),
    ...createLostReasonService({ run, audit }),
    ...createTeamService({ run, audit }),
    ...createPresetService({ run, audit }, presets),
    listAccounts(input: unknown) {
      const query = crmListSchema.parse(input)
      return run("accounts.read", async (tx, actor) => {
        const where: Prisma.CrmAccountWhereInput = { AND: [accountScope(actor), {
          archived: query.archived === "true",
          ...(query.q ? { OR: ["name", "email", "phone"].map(field => ({ [field]: { contains: query.q, mode: "insensitive" } })) } : {}),
        }] }
        const sort = ["name", "createdAt", "updatedAt"].includes(query.sort) ? query.sort : "updatedAt"
        const [items, total] = await Promise.all([
          tx.crmAccount.findMany({ where, orderBy: [{ [sort]: query.order }, { id: "asc" }], skip: (query.page - 1) * query.pageSize, take: query.pageSize }),
          tx.crmAccount.count({ where }),
        ])
        return pageResult(items, total, query.page, query.pageSize)
      })
    },
    getAccount(id: string) {
      return run("accounts.read", async (tx, actor) => {
        const account = await tx.crmAccount.findFirst({ where: { ...accountScope(actor), id } })
        if (!account) throw new CrmError(404, "Business account not found.")
        return { ...account, canEdit: permits(actor, "accounts.edit") && (canManageCrm(actor.role) || account.ownerUserId === actor.userId) }
      })
    },
    createAccount(input: unknown) {
      const data = crmAccountSchema.parse(input)
      return run("accounts.create", async (tx, actor) => { requireWriteFields(actor, "accounts", undefined, data);
        const account = await tx.crmAccount.create({ data: { ...data, email: data.email || null, phone: data.phone || null, website: data.website || null, notes: data.notes || null, tenantId: actor.tenantId, ownerUserId: actor.userId } })
        await audit(tx, actor, "crm.account.created", account.id, undefined, data)
        return account
      })
    },
    updateAccount(id: string, input: unknown) {
      const { version, ...data } = crmAccountUpdateSchema.parse(input)
      return run("accounts.edit", async (tx, actor) => {
        const where = { ...accountScope(actor), id, ...(!canManageCrm(actor.role) ? { ownerUserId: actor.userId } : {}) }
        const before = await tx.crmAccount.findFirst({ where })
        requireWriteFields(actor, "accounts", before ?? undefined, data)
        if (!before) throw new CrmError(404, "Editable business account not found.")
        const changed = await tx.crmAccount.updateMany({ where: { ...where, version }, data: { ...data, email: data.email || null, phone: data.phone || null, website: data.website || null, notes: data.notes || null, version: { increment: 1 } } })
        if (!changed.count) throw new CrmError(409, "This account changed. Refresh before saving.")
        await audit(tx, actor, "crm.account.updated", id, { name: before.name, email: before.email, phone: before.phone, website: before.website, notes: before.notes, archived: before.archived }, data)
        return tx.crmAccount.findFirstOrThrow({ where })
      })
    },
    listAccountContacts(accountId: string, input: unknown) {
      const query = crmListSchema.parse(input)
      return run(["accounts.read", "contacts.read"], async (tx, actor) => {
        const account = await tx.crmAccount.findFirst({ where: { ...accountScope(actor), id: accountId }, select: { id: true } })
        if (!account) throw new CrmError(404, "Business account not found.")
        // Account visibility must never grant access to unrelated contacts.
        const where: Prisma.CrmContactWhereInput = { AND: [contactScope(actor), {
          accounts: { some: { tenantId: actor.tenantId, accountId } }, archived: query.archived === "true",
          ...(query.q ? { name: { contains: query.q, mode: "insensitive" } } : {}),
        }] }
        const [items, total] = await Promise.all([
          tx.crmContact.findMany({ where, orderBy: [{ name: "asc" }, { id: "asc" }], skip: (query.page - 1) * query.pageSize, take: query.pageSize }),
          tx.crmContact.count({ where }),
        ])
        return pageResult(items, total, query.page, query.pageSize)
      })
    },
    listContactAccounts(contactId: string, input: unknown) {
      const query = crmListSchema.parse(input)
      return run(["contacts.read", "accounts.read"], async (tx, actor) => {
        const contact = await tx.crmContact.findFirst({ where: { ...contactScope(actor), id: contactId }, select: { id: true } })
        if (!contact) throw new CrmError(404, "Contact not found.")
        const where: Prisma.CrmAccountWhereInput = { AND: [accountScope(actor), { contacts: { some: { tenantId: actor.tenantId, contactId } },
          ...(query.activeOnly === "true" ? { archived: false } : {}),
          ...(query.q ? { name: { contains: query.q, mode: "insensitive" } } : {}),
        }] }
        const [items, total] = await Promise.all([
          tx.crmAccount.findMany({ where, orderBy: [{ name: "asc" }, { id: "asc" }], skip: (query.page - 1) * query.pageSize, take: query.pageSize }),
          tx.crmAccount.count({ where }),
        ])
        return pageResult(items, total, query.page, query.pageSize)
      })
    },
    linkContactAccount(contactId: string, input: unknown) {
      const { accountId } = crmAccountLinkSchema.parse(input)
      return run("contacts.edit", async (tx, actor) => {
        const contact = await tx.crmContact.findFirst({ where: { ...contactScope(actor), id: contactId, ...(!canManageCrm(actor.role) ? { ownerUserId: actor.userId } : {}) } })
        if (!contact) throw new CrmError(404, "Editable contact not found.")
        const account = await tx.crmAccount.findFirst({ where: { ...accountScope(actor), id: accountId } })
        if (!account) throw new CrmError(404, "Business account not found.")
        if (contact.archived || account.archived) throw new CrmError(409, "Restore the contact and account before adding a relationship.")
        const link = { tenantId: actor.tenantId, contactId, accountId }
        const created = await tx.crmAccountContact.createMany({ data: [link], skipDuplicates: true })
        if (created.count) {
          await audit(tx, actor, "crm.account.contact.linked", accountId, undefined, { contactId })
          await audit(tx, actor, "crm.contact.account.linked", contactId, undefined, { accountId })
        }
        return { success: true }
      })
    },
    unlinkContactAccount(contactId: string, accountId: string) {
      return run("contacts.edit", async (tx, actor) => {
        const contact = await tx.crmContact.findFirst({ where: { ...contactScope(actor), id: contactId, ...(!canManageCrm(actor.role) ? { ownerUserId: actor.userId } : {}) } })
        if (!contact) throw new CrmError(404, "Editable contact not found.")
        const removed = await tx.crmAccountContact.deleteMany({ where: { tenantId: actor.tenantId, contactId, accountId } })
        if (removed.count) {
          await audit(tx, actor, "crm.account.contact.unlinked", accountId, { contactId })
          await audit(tx, actor, "crm.contact.account.unlinked", contactId, { accountId })
        }
        return { success: true }
      })
    },
    listContacts(input: unknown) {
      const query = crmListSchema.parse(input)
      return run("contacts.read", async (tx, actor) => {
        const where: Prisma.CrmContactWhereInput = { AND: [contactScope(actor), {
          archived: query.archived === "true",
          ...(query.q ? { OR: ["name", "email", "phone"].map(field => ({ [field]: { contains: query.q, mode: "insensitive" } })) } : {}),
        }] }
        const sort = ["name", "createdAt", "updatedAt"].includes(query.sort) ? query.sort : "updatedAt"
        const [items, total] = await Promise.all([
          tx.crmContact.findMany({ where, orderBy: [{ [sort]: query.order }, { id: "asc" }], skip: (query.page - 1) * query.pageSize, take: query.pageSize }),
          tx.crmContact.count({ where }),
        ])
        return pageResult(items, total, query.page, query.pageSize)
      })
    },
    getContact(id: string) {
      return run("contacts.read", async (tx, actor) => {
        const contact = await tx.crmContact.findFirst({ where: { ...contactScope(actor), id } })
        if (!contact) throw new CrmError(404, "Contact not found.")
        return { ...contact, canEdit: permits(actor, "contacts.edit") && (canManageCrm(actor.role) || contact.ownerUserId === actor.userId) }
      })
    },
    createContact(input: unknown) {
      const data = crmContactSchema.parse(input)
      return run("contacts.create", async (tx, actor) => { requireWriteFields(actor, "contacts", undefined, data);
        const contact = await tx.crmContact.create({ data: { ...data, email: data.email || null, phone: data.phone || null, tenantId: actor.tenantId, ownerUserId: actor.userId } })
        await audit(tx, actor, "crm.contact.created", contact.id, undefined, data)
        return contact
      })
    },
    updateContact(id: string, input: unknown) {
      const { version, ...data } = crmContactUpdateSchema.parse(input)
      return run("contacts.edit", async (tx, actor) => {
        const where = { ...contactScope(actor), id, ...(!canManageCrm(actor.role) ? { ownerUserId: actor.userId } : {}) }
        const before = await tx.crmContact.findFirst({ where })
        requireWriteFields(actor, "contacts", before ?? undefined, data)
        if (!before) throw new CrmError(404, "Editable contact not found.")
        const changed = await tx.crmContact.updateMany({ where: { ...where, version }, data: { ...data, email: data.email || null, phone: data.phone || null, version: { increment: 1 } } })
        if (!changed.count) throw new CrmError(409, "This contact changed. Refresh before saving.")
        await audit(tx, actor, "crm.contact.updated", id, snapshot(before), data)
        return tx.crmContact.findFirstOrThrow({ where })
      })
    },
    listEnquiries(input: unknown, exporting = false) {
      const query = crmListSchema.parse(input)
      return run(exporting ? ["enquiries.read", "enquiries.export"] : "enquiries.read", async (tx, actor) => {
        const extensionFilter = await extensions.filters(tx, actor, query)
        const phoneQuery = query.q.replace(/[\s().-]/g, "")
        const where: Prisma.CrmEnquiryWhereInput = { AND: [enquiryScope(actor), {
          ...(query.status ? { status: query.status } : {}),
          sourceId: query.sourceId, assignedUserId: query.assignedUserId, lostReasonId: query.lostReasonId, salesTeamId: query.salesTeamId,
          ...extensionFilter.enquiry,
          ...await customFieldFilter(tx, actor, enquiryFields, query),
          ...(query.q ? { OR: [{ title: { contains: query.q, mode: "insensitive" } }, { contact: { name: { contains: query.q, mode: "insensitive" } } },
            { account: { name: { contains: query.q, mode: "insensitive" } } },
            ...(phoneQuery ? ["phone", "alternatePhone", "whatsappPhone"].map(field => ({ contact: { [field]: { contains: phoneQuery } } })) : []),
          ] } : {}),
        }] }
        const sort = ["title", "createdAt", "updatedAt"].includes(query.sort) ? query.sort : "updatedAt"
        const total = await tx.crmEnquiry.count({ where })
        if (exporting) checkExportLimit(total)
        const items = await tx.crmEnquiry.findMany({ where, include: enquiryInclude, orderBy: [{ [sort]: query.order }, { id: "asc" }], skip: exporting ? 0 : (query.page - 1) * query.pageSize, take: exporting ? CRM_EXPORT_LIMIT : query.pageSize })
        const decorated = await extensions.decorate(tx, actor, "enquiry", await maskReferrals(tx, actor, items))
        return { ...pageResult(decorated.items, total, query.page, query.pageSize), ...decorated.metadata, customFieldExport: exporting ? await customFieldExport(tx, actor, enquiryFields, items.map(item => item.id)) : undefined }
      })
    },
    getEnquiry(id: string) {
      return run("enquiries.read", async (tx, actor) => {
        const { items: [record] } = await extensions.decorate(tx, actor, "enquiry", await maskReferrals(tx, actor, [await findEnquiry(tx, actor, id)]))
        const events = await Promise.all(["created", "updated", "assigned"].map(event => tx.crmActivity.findFirst({ where: { tenantId: actor.tenantId, enquiryId: id, event }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], select: { createdAt: true, actor: { select: personSelect } } })))
        return { ...record, customFields: await readCustomFields(tx, actor, enquiryFields, record), metadata: { created: events[0], updated: events[1] || events[0], assigned: events[2] }, canAssign: canManageCrm(actor.role) && permits(actor, "enquiries.assign"), opportunity: await tx.crmOpportunity.findFirst({ where: { ...enquiryScope(actor), enquiryId: id }, select: { id: true } }) }
      })
    },
    createEnquiry(input: unknown) {
      const custom = splitCustomFields(input)
      const { core, extension } = extensions.splitWrite(custom.core)
      const data = crmEnquiryCreateSchema.parse(core)
      return run("enquiries.create", async (tx, actor) => { requireWriteFields(actor, "enquiries", undefined, data);
        await checkAssignee(tx, actor, data.assignedUserId)
        const team = await resolveSalesTeam(tx, actor, data.salesTeamId, data.assignedUserId)
        if (team?.workflow === "DIRECT") throw new CrmError(400, "This team starts with opportunities. Create an opportunity instead.")
        if (data.newContact) requirePermission(actor, "contacts.create")
        const contact = data.newContact
          ? await tx.crmContact.create({ data: { ...data.newContact, email: data.newContact.email || null, phone: data.newContact.phone || null, tenantId: actor.tenantId, ownerUserId: actor.userId } })
          : await tx.crmContact.findFirst({ where: { ...contactScope(actor), id: data.contactId, archived: false } })
        if (!contact) throw new CrmError(404, "Active contact not found.")
        if (data.newContact) {
          await audit(tx, actor, "crm.contact.created", contact.id, undefined, data.newContact)
          if (data.accountId) {
            const account = await tx.crmAccount.findFirst({ where: { ...accountScope(actor), id: data.accountId, archived: false }, select: { id: true } })
            if (!account) throw new CrmError(404, "Active business account not found.")
            await tx.crmAccountContact.create({ data: { tenantId: actor.tenantId, contactId: contact.id, accountId: account.id } })
            await audit(tx, actor, "crm.contact.account.linked", contact.id, undefined, { accountId: account.id })
            await audit(tx, actor, "crm.account.contact.linked", account.id, undefined, { contactId: contact.id })
          }
        }
        const context = await enquiryContext(tx, actor, contact.id, data)
        const enquiry = await tx.crmEnquiry.create({ data: { salesTeamId: team?.id ?? null, title: data.title, requirements: data.requirements, assignedUserId: data.assignedUserId, contactId: contact.id, ...context, tenantId: actor.tenantId }, include: enquiryInclude })
        await extensions.save(tx, actor, "enquiry", enquiry.id, extension)
        await saveCustomFields(tx, actor, enquiryFields, enquiry, custom.patch, true)
        await activity(tx, actor, enquiry.id, "created", "Enquiry created.")
        await activity(tx, actor, enquiry.id, "assigned", `Assigned to ${enquiry.assignee.name || "salesperson"}.`)
        await audit(tx, actor, "crm.enquiry.created", enquiry.id, undefined, snapshot(enquiry))
        return { ...(await extensions.decorate(tx, actor, "enquiry", await maskReferrals(tx, actor, [enquiry]))).items[0], customFields: await readCustomFields(tx, actor, enquiryFields, enquiry) }
      })
    },
    updateEnquiry(id: string, input: unknown) {
      const custom = splitCustomFields(input)
      const { core, extension } = extensions.splitWrite(custom.core)
      const { version, ...data } = crmEnquiryUpdateSchema.parse(core)
      return run("enquiries.edit", async (tx, actor) => {
        const before = await findEnquiry(tx, actor, id)
        requireWriteFields(actor, "enquiries", before ?? undefined, data)
        await checkAssignee(tx, actor, data.assignedUserId, before.assignedUserId)
        const team = await resolveSalesTeam(tx, actor, data.salesTeamId, data.assignedUserId, before)
        if (before.salesTeamId !== (team?.id ?? null) && await tx.crmOpportunity.count({ where: { tenantId: actor.tenantId, enquiryId: id } })) throw new CrmError(409, "A converted enquiry keeps its original sales team.")
        const fieldRecord = { ...before, salesTeamId: team?.id ?? null }
        const context = await enquiryContext(tx, actor, before.contactId, data, before)
        const lost = await resolveLostReason(tx, actor, data.status === "CLOSED", data.lostReasonId, before.status === "CLOSED" ? before : undefined)
        if (before.assignedUserId !== data.assignedUserId && await tx.crmTask.count({ where: { tenantId: actor.tenantId, enquiryId: id, followParentAssignment: true, status: { in: ["OPEN", "IN_PROGRESS"] } } })) requirePermission(actor, ["activities.edit", "activities.assign"])
        const changed = await tx.crmEnquiry.updateMany({ where: { ...enquiryScope(actor), id, version }, data: { ...data, salesTeamId: team?.id ?? null, ...context, ...lost, version: { increment: 1 } } })
        if (!changed.count) throw new CrmError(409, "This enquiry changed. Refresh before saving.")
        await extensions.save(tx, actor, "enquiry", id, extension)
        await saveCustomFields(tx, actor, enquiryFields, fieldRecord, custom.patch)
        if (before.assignedUserId !== data.assignedUserId) {
          const nextOwner = await tx.user.findFirstOrThrow({ where: { tenantId: actor.tenantId, id: data.assignedUserId }, select: personSelect })
          await activity(tx, actor, id, "assigned", `Salesperson changed from ${before.assignee.name || "unnamed user"} to ${nextOwner.name || "unnamed user"}.`)
          const inherited = await tx.crmTask.findMany({ where: { tenantId: actor.tenantId, enquiryId: id, followParentAssignment: true, status: { in: ["OPEN", "IN_PROGRESS"] } }, select: { id: true } })
          // The database bridge transfers inherited assignments for old and new clients.
          // New clients additionally record who performed the handoff in activity history.
          if (inherited.length) await tx.crmTaskEvent.createMany({ data: inherited.map(item => ({ tenantId: actor.tenantId, taskId: item.id, actorUserId: actor.userId, event: "crm.work.assignment.inherited", message: "Activity reassigned with its enquiry." })) })
        }
        await activity(tx, actor, id, "updated", `Enquiry updated. Status: ${data.status === "CLOSED" ? "Lost" : data.status}.${lost.lostReasonName ? ` Lost reason: ${lost.lostReasonName}.` : ""}${data.assignedUserId !== before.assignedUserId ? " Salesperson changed." : ""}`)
        await audit(tx, actor, "crm.enquiry.updated", id, snapshot(before), snapshot({ ...data, ...context, ...lost }))
        return { ...(await extensions.decorate(tx, actor, "enquiry", await maskReferrals(tx, actor, [await tx.crmEnquiry.findFirstOrThrow({ where: { tenantId: actor.tenantId, id }, include: enquiryInclude })]))).items[0], customFields: await readCustomFields(tx, actor, enquiryFields, fieldRecord) }
      })
    },
    listTasks(input: unknown, enquiryId?: string) {
      const query = crmListSchema.parse(input)
      return run("activities.read", async (tx, actor) => {
        if (enquiryId) await findEnquiry(tx, actor, enquiryId)
        const settings = await tx.appSetting.findUnique({ where: { tenantId: actor.tenantId }, select: { timeZone: true } })
        const today = new Intl.DateTimeFormat("en-CA", { timeZone: settings?.timeZone || "UTC", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date())
        const where: Prisma.CrmTaskWhereInput = {
          tenantId: actor.tenantId, followParentAssignment: true, status: { not: "CANCELLED" }, enquiry: enquiryScope(actor), ...(enquiryId ? { enquiryId } : {}),
          ...(query.due === "completed" ? { completedAt: { not: null } } : { completedAt: null }),
          ...(query.due === "overdue" ? { dueOn: { lt: new Date(`${today}T00:00:00Z`) } } : {}),
          ...(query.q ? { title: { contains: query.q, mode: "insensitive" } } : {}),
        }
        const [items, total] = await Promise.all([
          tx.crmTask.findMany({ where, include: { enquiry: { select: { id: true, title: true } } }, orderBy: [{ dueOn: "asc" }, { id: "asc" }], skip: (query.page - 1) * query.pageSize, take: query.pageSize }),
          tx.crmTask.count({ where }),
        ])
        return pageResult(items, total, query.page, query.pageSize)
      })
    },
    createTask(enquiryId: string, input: unknown) {
      const data = crmTaskSchema.parse(input)
      return run("activities.create", async (tx, actor) => {
        const enquiry = await findEnquiry(tx, actor, enquiryId)
        if (enquiry.status === "CLOSED") throw new CrmError(409, "Reopen the enquiry before adding follow-ups.")
        requireWriteFields(actor, "activities", undefined, { assignedUserId: enquiry.assignedUserId })
        const task = await tx.crmTask.create({ data: { ...data, dueOn: new Date(`${data.dueOn}T00:00:00Z`), tenantId: actor.tenantId, enquiryId, contactId: enquiry.contactId, assignedUserId: enquiry.assignedUserId, createdByUserId: actor.userId, followParentAssignment: true } })
        await activity(tx, actor, enquiryId, "task.created", `Follow-up: ${data.title} (due ${data.dueOn}).`)
        await audit(tx, actor, "crm.task.created", enquiryId, undefined, { taskId: task.id, ...data })
        return task
      })
    },
    completeTask(id: string) {
      return run("activities.edit", async (tx, actor) => {
        const task = await tx.crmTask.findFirst({ where: { id, tenantId: actor.tenantId, followParentAssignment: true, enquiry: enquiryScope(actor) } })
        if (!task || !task.enquiryId) throw new CrmError(404, "Follow-up not found.")
        if (task.completedAt) return task
        if (task.status === "CANCELLED") throw new CrmError(409, "This follow-up was cancelled.")
        const updated = await tx.crmTask.update({ where: { id: task.id, tenantId: actor.tenantId }, data: { status: "COMPLETED", completedAt: new Date(), completedByUserId: actor.userId, version: { increment: 1 } } })
        await activity(tx, actor, task.enquiryId, "task.completed", `Completed: ${task.title}.`)
        await audit(tx, actor, "crm.task.completed", task.enquiryId, undefined, { taskId: task.id })
        return updated
      })
    },
    addNote(enquiryId: string, input: unknown) {
      const { message } = crmNoteSchema.parse(input)
      return run("enquiries.edit", async (tx, actor) => {
        await findEnquiry(tx, actor, enquiryId)
        await activity(tx, actor, enquiryId, "note", message)
        await audit(tx, actor, "crm.note.created", enquiryId)
        return { success: true }
      })
    },
    listActivity(enquiryId: string, input: unknown) {
      const query = crmListSchema.parse(input)
      return run("enquiries.read", async (tx, actor) => {
        await findEnquiry(tx, actor, enquiryId)
        const where = { tenantId: actor.tenantId, enquiryId }
        const [items, total] = await Promise.all([
          tx.crmActivity.findMany({ where, include: { actor: { select: personSelect } }, orderBy: [{ createdAt: "desc" }, { id: "asc" }], skip: (query.page - 1) * query.pageSize, take: query.pageSize }),
          tx.crmActivity.count({ where }),
        ])
        return pageResult(items, total, query.page, query.pageSize)
      })
    },
    listAssignees(input: unknown) {
      const query = crmListSchema.parse(input)
      return run(workspaceRead, async (tx, actor) => {
        const where: Prisma.UserWhereInput = { status: "ACTIVE", role: { in: ["ADMIN", "MANAGER", "STAFF"] },
          ...assigneeScope(actor),
          ...(query.salesTeamId ? { crmSalesTeamMemberships: { some: { tenantId: actor.tenantId, teamId: query.salesTeamId } } } : {}),
          ...(query.q ? { name: { contains: query.q, mode: "insensitive" } } : {}),
        }
        const [items, total] = await Promise.all([
          tx.user.findMany({ where, select: personSelect, orderBy: [{ name: "asc" }, { id: "asc" }], skip: (query.page - 1) * query.pageSize, take: query.pageSize }),
          tx.user.count({ where }),
        ])
        return { ...pageResult(items, total, query.page, query.pageSize), currentUserId: actor.userId, canAssign: canManageCrm(actor.role) }
      })
    },
  }
}
