import { createSalesReportService } from "./sales-report-service"
import { checkExportLimit, CRM_EXPORT_LIMIT } from "./csv"
import type { Prisma, PrismaClient, Role } from "@prisma/client"
import { recordDomainAuditEvent } from "@/lib/domain-audit"
import { createSalesService } from "./sales-service"
import { createWorkService } from "./work-service"
import { createReportService } from "./report-service"
import { createFollowUpService } from "./follow-up-service"
import { createIntakeService, enquiryContext, maskReferrals, referralInclude } from "./intake-service"
import { savePropertyContext, withPropertyContext, requirePropertyFilter, projectFilterChoices, realEstateEnabled } from "@/modules/real-estate/sales-context"
import { CrmError, canManageCrm, canUseCrm, contactScope, accountScope, enquiryScope, type CrmActor } from "./policy"
import {
  crmContactSchema, crmContactUpdateSchema, crmEnquiryCreateSchema,
  crmEnquiryUpdateSchema, crmListSchema, crmNoteSchema, crmTaskSchema,
  crmAccountSchema, crmAccountUpdateSchema, crmAccountLinkSchema,
} from "./validation"

const personSelect = { id: true, name: true } as const
const contactSelect = { id: true, name: true, email: true, phone: true, archived: true } as const
const enquiryInclude = { contact: { select: contactSelect }, assignee: { select: personSelect }, account: { select: { id: true, name: true } }, leadSource: { select: { id: true, name: true, archived: true } }, ...referralInclude } as const
const snapshot = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value))
type Tx = Prisma.TransactionClient

function pageResult<T>(items: T[], total: number, page: number, pageSize: number) {
  return { items, total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)) }
}

// No HTTP or Lia dependencies. Every operation checks current membership and
// module access, then runs in a transaction. Caller must establish DB tenant context.
export function createCrmService(db: PrismaClient, identity: Pick<CrmActor, "tenantId" | "userId" | "requestId">) {
  async function run<T>(operation: (tx: Tx, actor: CrmActor) => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      try {
        // A page loads several CRM panels concurrently through the small tenant
        // pool. Allow bounded queueing beyond Prisma's two-second default while
        // retaining the execution limit for up to 12 audited plan activities.
        return await db.$transaction(async tx => {
          const user = await tx.user.findFirst({
            where: { id: identity.userId, tenantId: identity.tenantId, status: "ACTIVE" },
            select: { role: true, tenant: { select: { status: true, slug: true } } },
          })
          const platformSlug = process.env.PLATFORM_ADMIN_TENANT_SLUG?.trim().toLowerCase() || "platform"
          if (!user || !canUseCrm(user.role) || user.tenant?.status !== "ACTIVE" || user.tenant.slug === platformSlug) {
            throw new CrmError(403, "CRM access is not permitted.")
          }
          const enabledModule = await tx.tenantModule.findUnique({
            where: { tenantId_key: { tenantId: identity.tenantId, key: "crm" } },
          })
          if (!enabledModule?.enabled) throw new CrmError(403, "CRM is not enabled for this business.")
          return operation(tx, { ...identity, role: user.role })
        }, { isolationLevel: "Serializable", maxWait: 20000, timeout: 20000 })
      } catch (error) {
        const code = (error as { code?: string })?.code
        if (code === "P2034" && attempt < 2) continue
        if (code === "P2002") {
          // The PostgreSQL driver adapter reports constraint fields in its
          // nested cause rather than Prisma's legacy meta.target location.
          const meta = (error as { meta?: { target?: unknown; driverAdapterError?: { cause?: { constraint?: { fields?: unknown } } } } }).meta
          const target = String(meta?.target || meta?.driverAdapterError?.cause?.constraint?.fields || "")
          if (target.includes("nameKey")) throw new CrmError(409, "This lead source already exists. Edit or restore it.")
          if (target.includes("sourceType") && target.includes("outcome")) throw new CrmError(409, "A rule for this activity type and outcome already exists. Edit or restore that rule.")
          if (target.includes("requestKey")) { if (attempt < 2) continue; throw new CrmError(409, "This plan application is being processed. Retry to see its activities.") }
          if (target.includes("followUpOfId")) throw new CrmError(409, "A next follow-up was already scheduled. Refresh to see it.")
          // A competing conversion may win the unique enquiry link before this
          // transaction commits. Retry to return the authorized existing deal.
          if (target.includes("enquiryId") && attempt < 2) continue
          throw new CrmError(409, target.includes("enquiryId") ? "This enquiry already has an opportunity. Refresh to open it." : "A contact with this email or phone already exists in this business. Ask your manager if you cannot find it.")
        }
        if (code === "P2034") throw new CrmError(409, "This record changed. Refresh and try again.")
        throw error
      }
    }
  }

  async function audit(tx: Tx, actor: CrmActor, event: string, entityId: string, before?: Prisma.InputJsonValue, after?: Prisma.InputJsonValue) {
    await recordDomainAuditEvent(tx, {
      tenantId: actor.tenantId, actorUserId: actor.userId, actorRole: actor.role as Role,
      requestId: actor.requestId, event, entityType: event.startsWith("crm.source.") ? "CrmLeadSource" : event.startsWith("crm.rule.") ? "CrmFollowUpRule" : event.startsWith("crm.plan.") ? "CrmActivityPlan" : event.startsWith("crm.work") ? "CrmTask" : event.startsWith("crm.opportunity") ? "CrmOpportunity" : event.startsWith("crm.pipeline") ? "CrmPipeline" : event.startsWith("crm.account") ? "CrmAccount" : event.startsWith("crm.contact") ? "CrmContact" : "CrmEnquiry",
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

  async function checkAssignee(tx: Tx, actor: CrmActor, assignedUserId: string) {
    if (!canManageCrm(actor.role) && assignedUserId !== actor.userId) throw new CrmError(403, "Only a manager can assign another salesperson.")
    const assignee = await tx.user.findFirst({
      where: { id: assignedUserId, tenantId: actor.tenantId, status: "ACTIVE", role: { in: ["ADMIN", "MANAGER", "STAFF"] } },
      select: { id: true },
    })
    if (!assignee) throw new CrmError(400, "Choose an active salesperson in this business.")
  }

  return {
    listProjectFilterChoices(input: unknown) { return run((tx, actor) => projectFilterChoices(tx, actor, input)) },
    ...createSalesService({ run, audit, checkAssignee }),
    ...createWorkService({ run, audit, checkAssignee }),
    ...createReportService({ run }),
    ...createSalesReportService({ run }),
    ...createFollowUpService({ run, audit }),
    ...createIntakeService({ run, audit }),
    listAccounts(input: unknown) {
      const query = crmListSchema.parse(input)
      return run(async (tx, actor) => {
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
      return run(async (tx, actor) => {
        const account = await tx.crmAccount.findFirst({ where: { ...accountScope(actor), id } })
        if (!account) throw new CrmError(404, "Business account not found.")
        return { ...account, canEdit: canManageCrm(actor.role) || account.ownerUserId === actor.userId }
      })
    },
    createAccount(input: unknown) {
      const data = crmAccountSchema.parse(input)
      return run(async (tx, actor) => {
        const account = await tx.crmAccount.create({ data: { ...data, email: data.email || null, phone: data.phone || null, website: data.website || null, notes: data.notes || null, tenantId: actor.tenantId, ownerUserId: actor.userId } })
        await audit(tx, actor, "crm.account.created", account.id, undefined, data)
        return account
      })
    },
    updateAccount(id: string, input: unknown) {
      const { version, ...data } = crmAccountUpdateSchema.parse(input)
      return run(async (tx, actor) => {
        const where = { tenantId: actor.tenantId, id, ...(!canManageCrm(actor.role) ? { ownerUserId: actor.userId } : {}) }
        const before = await tx.crmAccount.findFirst({ where })
        if (!before) throw new CrmError(404, "Editable business account not found.")
        const changed = await tx.crmAccount.updateMany({ where: { ...where, version }, data: { ...data, email: data.email || null, phone: data.phone || null, website: data.website || null, notes: data.notes || null, version: { increment: 1 } } })
        if (!changed.count) throw new CrmError(409, "This account changed. Refresh before saving.")
        await audit(tx, actor, "crm.account.updated", id, { name: before.name, email: before.email, phone: before.phone, website: before.website, notes: before.notes, archived: before.archived }, data)
        return tx.crmAccount.findFirstOrThrow({ where })
      })
    },
    listAccountContacts(accountId: string, input: unknown) {
      const query = crmListSchema.parse(input)
      return run(async (tx, actor) => {
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
      return run(async (tx, actor) => {
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
      return run(async (tx, actor) => {
        const contact = await tx.crmContact.findFirst({ where: { tenantId: actor.tenantId, id: contactId, ...(!canManageCrm(actor.role) ? { ownerUserId: actor.userId } : {}) } })
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
      return run(async (tx, actor) => {
        const contact = await tx.crmContact.findFirst({ where: { tenantId: actor.tenantId, id: contactId, ...(!canManageCrm(actor.role) ? { ownerUserId: actor.userId } : {}) } })
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
      return run(async (tx, actor) => {
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
      return run(async (tx, actor) => {
        const contact = await tx.crmContact.findFirst({ where: { ...contactScope(actor), id } })
        if (!contact) throw new CrmError(404, "Contact not found.")
        return { ...contact, canEdit: canManageCrm(actor.role) || contact.ownerUserId === actor.userId }
      })
    },
    createContact(input: unknown) {
      const data = crmContactSchema.parse(input)
      return run(async (tx, actor) => {
        const contact = await tx.crmContact.create({ data: { ...data, email: data.email || null, phone: data.phone || null, tenantId: actor.tenantId, ownerUserId: actor.userId } })
        await audit(tx, actor, "crm.contact.created", contact.id, undefined, data)
        return contact
      })
    },
    updateContact(id: string, input: unknown) {
      const { version, ...data } = crmContactUpdateSchema.parse(input)
      return run(async (tx, actor) => {
        const where = { tenantId: actor.tenantId, id, ...(!canManageCrm(actor.role) ? { ownerUserId: actor.userId } : {}) }
        const before = await tx.crmContact.findFirst({ where })
        if (!before) throw new CrmError(404, "Editable contact not found.")
        const changed = await tx.crmContact.updateMany({ where: { ...where, version }, data: { ...data, email: data.email || null, phone: data.phone || null, version: { increment: 1 } } })
        if (!changed.count) throw new CrmError(409, "This contact changed. Refresh before saving.")
        await audit(tx, actor, "crm.contact.updated", id, snapshot(before), data)
        return tx.crmContact.findFirstOrThrow({ where })
      })
    },
    listEnquiries(input: unknown, exporting = false) {
      const query = crmListSchema.parse(input)
      return run(async (tx, actor) => {
        const propertyContext = await requirePropertyFilter(tx, actor, query)
        const phoneQuery = query.q.replace(/[\s().-]/g, "")
        const where: Prisma.CrmEnquiryWhereInput = { AND: [enquiryScope(actor), {
          ...(query.status ? { status: query.status } : {}),
          sourceId: query.sourceId, assignedUserId: query.assignedUserId,
          ...(propertyContext ? { propertyContext: { is: propertyContext } } : {}),
          ...(query.q ? { OR: [{ title: { contains: query.q, mode: "insensitive" } }, { contact: { name: { contains: query.q, mode: "insensitive" } } },
            { account: { name: { contains: query.q, mode: "insensitive" } } },
            ...(phoneQuery ? ["phone", "alternatePhone", "whatsappPhone"].map(field => ({ contact: { [field]: { contains: phoneQuery } } })) : []),
          ] } : {}),
        }] }
        const sort = ["title", "createdAt", "updatedAt"].includes(query.sort) ? query.sort : "updatedAt"
        const total = await tx.crmEnquiry.count({ where })
        if (exporting) checkExportLimit(total)
        const items = await tx.crmEnquiry.findMany({ where, include: enquiryInclude, orderBy: [{ [sort]: query.order }, { id: "asc" }], skip: exporting ? 0 : (query.page - 1) * query.pageSize, take: exporting ? CRM_EXPORT_LIMIT : query.pageSize })
        const decorated = await withPropertyContext(tx, actor, "enquiry", await maskReferrals(tx, actor, items))
        return { ...pageResult(decorated, total, query.page, query.pageSize), realEstateEnabled: decorated[0]?.realEstateEnabled ?? await realEstateEnabled(tx, actor.tenantId) }
      })
    },
    getEnquiry(id: string) {
      return run(async (tx, actor) => {
        const [record] = await withPropertyContext(tx, actor, "enquiry", await maskReferrals(tx, actor, [await findEnquiry(tx, actor, id)]))
        const events = await Promise.all(["created", "updated", "assigned"].map(event => tx.crmActivity.findFirst({ where: { tenantId: actor.tenantId, enquiryId: id, event }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], select: { createdAt: true, actor: { select: personSelect } } })))
        return { ...record, metadata: { created: events[0], updated: events[1] || events[0], assigned: events[2] }, canAssign: canManageCrm(actor.role), opportunity: await tx.crmOpportunity.findFirst({ where: { ...enquiryScope(actor), enquiryId: id }, select: { id: true } }) }
      })
    },
    createEnquiry(input: unknown) {
      const data = crmEnquiryCreateSchema.parse(input)
      return run(async (tx, actor) => {
        await checkAssignee(tx, actor, data.assignedUserId)
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
        const enquiry = await tx.crmEnquiry.create({ data: { title: data.title, requirements: data.requirements, assignedUserId: data.assignedUserId, contactId: contact.id, ...context, tenantId: actor.tenantId }, include: enquiryInclude })
        await savePropertyContext(tx, actor, "enquiry", enquiry.id, data.propertyContext)
        await activity(tx, actor, enquiry.id, "created", "Enquiry created.")
        await activity(tx, actor, enquiry.id, "assigned", `Assigned to ${enquiry.assignee.name || "salesperson"}.`)
        await audit(tx, actor, "crm.enquiry.created", enquiry.id, undefined, snapshot(enquiry))
        return (await withPropertyContext(tx, actor, "enquiry", await maskReferrals(tx, actor, [enquiry])))[0]
      })
    },
    updateEnquiry(id: string, input: unknown) {
      const { version, propertyContext, ...data } = crmEnquiryUpdateSchema.parse(input)
      return run(async (tx, actor) => {
        const before = await findEnquiry(tx, actor, id)
        await checkAssignee(tx, actor, data.assignedUserId)
        const context = await enquiryContext(tx, actor, before.contactId, data, before)
        const changed = await tx.crmEnquiry.updateMany({ where: { ...enquiryScope(actor), id, version }, data: { ...data, ...context, version: { increment: 1 } } })
        if (!changed.count) throw new CrmError(409, "This enquiry changed. Refresh before saving.")
        await savePropertyContext(tx, actor, "enquiry", id, propertyContext)
        if (before.assignedUserId !== data.assignedUserId) {
          const nextOwner = await tx.user.findFirstOrThrow({ where: { tenantId: actor.tenantId, id: data.assignedUserId }, select: personSelect })
          await activity(tx, actor, id, "assigned", `Salesperson changed from ${before.assignee.name || "unnamed user"} to ${nextOwner.name || "unnamed user"}.`)
          const inherited = await tx.crmTask.findMany({ where: { tenantId: actor.tenantId, enquiryId: id, followParentAssignment: true, status: { in: ["OPEN", "IN_PROGRESS"] } }, select: { id: true } })
          // The database bridge transfers inherited assignments for old and new clients.
          // New clients additionally record who performed the handoff in activity history.
          if (inherited.length) await tx.crmTaskEvent.createMany({ data: inherited.map(item => ({ tenantId: actor.tenantId, taskId: item.id, actorUserId: actor.userId, event: "crm.work.assignment.inherited", message: "Activity reassigned with its enquiry." })) })
        }
        await activity(tx, actor, id, "updated", `Enquiry updated. Status: ${data.status}.${data.assignedUserId !== before.assignedUserId ? " Salesperson changed." : ""}`)
        await audit(tx, actor, "crm.enquiry.updated", id, snapshot(before), snapshot({ ...data, ...context }))
        return (await withPropertyContext(tx, actor, "enquiry", await maskReferrals(tx, actor, [await tx.crmEnquiry.findFirstOrThrow({ where: { tenantId: actor.tenantId, id }, include: enquiryInclude })])))[0]
      })
    },
    listTasks(input: unknown, enquiryId?: string) {
      const query = crmListSchema.parse(input)
      return run(async (tx, actor) => {
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
      return run(async (tx, actor) => {
        const enquiry = await findEnquiry(tx, actor, enquiryId)
        if (enquiry.status === "CLOSED") throw new CrmError(409, "Reopen the enquiry before adding follow-ups.")
        const task = await tx.crmTask.create({ data: { ...data, dueOn: new Date(`${data.dueOn}T00:00:00Z`), tenantId: actor.tenantId, enquiryId, contactId: enquiry.contactId, assignedUserId: enquiry.assignedUserId, createdByUserId: actor.userId, followParentAssignment: true } })
        await activity(tx, actor, enquiryId, "task.created", `Follow-up: ${data.title} (due ${data.dueOn}).`)
        await audit(tx, actor, "crm.task.created", enquiryId, undefined, { taskId: task.id, ...data })
        return task
      })
    },
    completeTask(id: string) {
      return run(async (tx, actor) => {
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
      return run(async (tx, actor) => {
        await findEnquiry(tx, actor, enquiryId)
        await activity(tx, actor, enquiryId, "note", message)
        await audit(tx, actor, "crm.note.created", enquiryId)
        return { success: true }
      })
    },
    listActivity(enquiryId: string, input: unknown) {
      const query = crmListSchema.parse(input)
      return run(async (tx, actor) => {
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
      return run(async (tx, actor) => {
        const where: Prisma.UserWhereInput = { tenantId: actor.tenantId, status: "ACTIVE", role: { in: ["ADMIN", "MANAGER", "STAFF"] },
          ...(!canManageCrm(actor.role) ? { id: actor.userId } : {}),
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
