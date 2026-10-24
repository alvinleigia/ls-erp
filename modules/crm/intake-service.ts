import { termText } from "@/platform/terminology/message"
import { requireWriteFields, permits } from "@/platform/access/policy"
import type { PermissionRun } from "@/platform/access/server"
import type { Prisma, CrmEnquiry } from "@prisma/client"
import { recordLimits } from "@/platform/access/rules"
import { accountScope, contactScope, CrmError, type CrmActor } from "./policy"
import { crmLeadSourceSchema, crmLeadSourceUpdateSchema, crmLeadSourceListSchema } from "./validation"
import { recordDomainAuditEvent } from "@/lib/domain-audit"

type Tx = Prisma.TransactionClient
type Context = {
  run: PermissionRun
  audit: (tx: Tx, actor: CrmActor, event: string, id: string, before?: Prisma.InputJsonValue, after?: Prisma.InputJsonValue) => Promise<void>
}
const sourceKey = (name: string) => name.trim().replace(/\s+/g, " ").toLowerCase()
export const referralInclude = {
  referralContact: { select: { id: true, name: true } },
  referralAccount: { select: { id: true, name: true } },
} as const

// Attribution never grants access to an otherwise private referrer. Batch the
// checks so enquiry/opportunity lists retain server-side pagination efficiency.
export async function maskReferrals<T extends { referralContactId: string | null; referralAccountId: string | null }>(tx: Tx, actor: CrmActor, rows: T[]) {
  if (recordLimits(actor, "contacts", "read").length === 0 && recordLimits(actor, "accounts", "read").length === 0) return rows.map(row => ({ ...row, referralRestricted: false }))
  const contactIds = rows.flatMap(row => row.referralContactId ? [row.referralContactId] : [])
  const accountIds = rows.flatMap(row => row.referralAccountId ? [row.referralAccountId] : [])
  const [contacts, accounts] = await Promise.all([
    contactIds.length ? tx.crmContact.findMany({ where: { ...contactScope(actor), id: { in: contactIds } }, select: { id: true } }) : [],
    accountIds.length ? tx.crmAccount.findMany({ where: { ...accountScope(actor), id: { in: accountIds } }, select: { id: true } }) : [],
  ])
  return rows.map(row => {
    const hidden = (row.referralContactId && !contacts.some(item => item.id === row.referralContactId)) || (row.referralAccountId && !accounts.some(item => item.id === row.referralAccountId))
    return hidden ? { ...row, referralContactId: null, referralAccountId: null, referralContact: null, referralAccount: null, referralRestricted: true } : { ...row, referralRestricted: false }
  })
}

type IntakeFields = { source?: string; sourceId?: string; accountId?: string; referralContactId?: string; referralAccountId?: string; targetCloseOn?: string }
export async function enquiryContext(tx: Tx, actor: CrmActor, contactId: string, data: IntakeFields, before?: CrmEnquiry) {
  let sourceId = before?.sourceId ?? null, source = before?.source ?? null
  if (data.sourceId !== undefined) {
    sourceId = data.sourceId || null
    if (sourceId !== (before?.sourceId ?? null)) {
      const choice = sourceId ? await tx.crmLeadSource.findFirst({ where: { tenantId: actor.tenantId, id: sourceId, archived: false } }) : null
      if (sourceId && !choice) throw new CrmError(400, "Choose an active lead source.")
      source = choice?.name ?? null
    }
  } else if (data.source !== undefined && data.source !== (before?.source ?? "")) {
    // Typed source names resolve to managed choices. Creating a missing choice
    // requires its own Create permission, independently of the sales write.
    const name = data.source.trim().replace(/\s+/g, " ")
    let choice = name ? await tx.crmLeadSource.findUnique({ where: { tenantId_nameKey: { tenantId: actor.tenantId, nameKey: sourceKey(name) } } }) : null
    if (name && !choice) {
      if (!permits(actor, "leadSources.create")) throw new CrmError(400, "Choose an existing lead source or ask someone with lead-source access to add it.")
      choice = await tx.crmLeadSource.create({ data: { tenantId: actor.tenantId, name, nameKey: sourceKey(name) } })
      await recordDomainAuditEvent(tx, { tenantId: actor.tenantId, actorUserId: actor.userId, actorRole: actor.role, event: "crm.source.created", entityType: "CrmLeadSource", entityId: choice.id, after: { name }, requestId: actor.requestId })
    }
    if (choice?.archived) throw new CrmError(400, "Choose an active lead source.")
    sourceId = choice?.id ?? null; source = name || null
  }
  const accountId = data.accountId === undefined ? before?.accountId ?? null : data.accountId || null
  if (accountId && accountId !== before?.accountId) {
    const account = await tx.crmAccount.findFirst({ where: { ...accountScope(actor), id: accountId, archived: false, contacts: { some: { tenantId: actor.tenantId, contactId } } } })
    if (!account) throw new CrmError(400, ["Choose an active ", termText("crm.account.singular", "business account"), " linked to this ", termText("crm.contact.singular", "contact"), "."])
  }
  const referralContactId = data.referralContactId === undefined ? before?.referralContactId ?? null : data.referralContactId || null
  const referralAccountId = data.referralAccountId === undefined ? before?.referralAccountId ?? null : data.referralAccountId || null
  if (referralContactId && referralAccountId) throw new CrmError(400, "Choose a referring person or company, not both.")
  if (referralContactId && referralContactId !== before?.referralContactId && !await tx.crmContact.findFirst({ where: { ...contactScope(actor), id: referralContactId, archived: false }, select: { id: true } })) throw new CrmError(404, termText("crm.contact.singular", "Referring contact not found.", "Referring {label} not found."))
  if (referralAccountId && referralAccountId !== before?.referralAccountId && !await tx.crmAccount.findFirst({ where: { ...accountScope(actor), id: referralAccountId, archived: false }, select: { id: true } })) throw new CrmError(404, termText("crm.account.singular", "Referring account not found.", "Referring {label} not found."))
  return { sourceId, source, accountId, referralContactId, referralAccountId,
    targetCloseOn: data.targetCloseOn === undefined ? before?.targetCloseOn ?? null : data.targetCloseOn ? new Date(`${data.targetCloseOn}T00:00:00Z`) : null }
}

export function createIntakeService({ run, audit }: Context) {
  return {
    listLeadSources(input: unknown) {
      const query = crmLeadSourceListSchema.parse(input)
      return run("leadSources.read", async (tx, actor) => {
        const where = { tenantId: actor.tenantId, ...(query.includeArchived === "true" ? {} : { archived: query.archived === "true" }), name: { contains: query.q, mode: "insensitive" as const } }
        const [items, total] = await Promise.all([
          tx.crmLeadSource.findMany({ where, orderBy: [{ name: "asc" }, { id: "asc" }], skip: (query.page - 1) * query.pageSize, take: query.pageSize }), tx.crmLeadSource.count({ where }),
        ])
        return { items, total, page: query.page, pageSize: query.pageSize, totalPages: Math.max(1, Math.ceil(total / query.pageSize)), canManage: permits(actor, "leadSources.edit") }
      })
    },
    createLeadSource(input: unknown) {
      const data = crmLeadSourceSchema.parse(input)
      return run("leadSources.create", async (tx, actor) => { requireWriteFields(actor, "leadSources", undefined, data);
        const record = await tx.crmLeadSource.create({ data: { ...data, nameKey: sourceKey(data.name), tenantId: actor.tenantId } })
        await audit(tx, actor, "crm.source.created", record.id, undefined, data)
        return record
      })
    },
    updateLeadSource(id: string, input: unknown) {
      const { version, ...data } = crmLeadSourceUpdateSchema.parse(input)
      return run("leadSources.edit", async (tx, actor) => {
        const before = await tx.crmLeadSource.findFirst({ where: { tenantId: actor.tenantId, id } })
        requireWriteFields(actor, "leadSources", before ?? undefined, data)
        if (!before) throw new CrmError(404, "Lead source not found.")
        const changed = await tx.crmLeadSource.updateMany({ where: { tenantId: actor.tenantId, id, version }, data: { ...data, nameKey: sourceKey(data.name), version: { increment: 1 } } })
        if (!changed.count) throw new CrmError(409, "This source changed. Refresh before saving.")
        await audit(tx, actor, "crm.source.updated", id, { name: before.name, archived: before.archived }, data)
        return tx.crmLeadSource.findFirstOrThrow({ where: { tenantId: actor.tenantId, id } })
      })
    },
  }
}
