import { readParticipantConfiguration, type ParticipantPresetReader } from "@/platform/participants/configuration"
import { genericParticipantPreset, missingParticipantInformation } from "@/platform/participants/requirements"
import { informationPartyKey } from "@/platform/participants/information"
import { pruneParticipantInformation } from "@/platform/participants/source-information"
import { participantInformationSaveSchema } from "@/platform/participants/validation"
import { crmSourceParticipants } from "./participant-source"
import type { PermissionRun } from "@/platform/access/server"
import { z } from "zod"
import type { Prisma } from "@prisma/client"
import { permits, requirePermission } from "@/platform/access/policy"
import { BusinessError } from "@/platform/policy"
import { participantKey, participantReplacementSchema, type ParticipantEditorData, type ParticipantSnapshot } from "@/platform/participants/validation"
import type { CrmServiceContext } from "./service-context"
import { accountScope, contactScope, opportunityScope, type CrmActor } from "./policy"
import { combineParticipants, participantOrder, savedParticipant } from "./participant-source"
import { crmQuotationParticipants } from "./participants"

type Tx = Prisma.TransactionClient
const personSelect = { id: true, tenantId: true, name: true, email: true, phone: true, version: true } as const
const businessSelect = { id: true, tenantId: true, name: true, version: true } as const
export const participantSourceSelect = { id: true, tenantId: true, version: true, participantInformation: true, contact: { select: personSelect }, account: { select: businessSelect } } as const
const querySchema = z.object({ kind: z.enum(["PERSON", "BUSINESS"]), q: z.string().trim().max(200).default(""), page: z.coerce.number().int().min(1).max(100000).default(1), pageSize: z.coerce.number().int().min(1).max(50).default(20), selectedId: z.string().max(100).optional() }).strict()
const notFound = () => new BusinessError(404, "Opportunity not found.")
const evidence = (row: ParticipantSnapshot["participants"][number]) => {
  const { name, email, phone, sourceVersion } = row.party
  return { name, email, phone, sourceVersion }
}

export function createOpportunityParticipantService({ run, runLocked, audit }: CrmServiceContext & { runLocked: PermissionRun }, preset?: ParticipantPresetReader) {
  async function source(tx: Tx, actor: CrmActor, id: string, edit = false) {
    const row = await tx.crmOpportunity.findFirst({ where: { ...opportunityScope(actor, edit ? "edit" : "read"), id }, select: participantSourceSelect })
    if (!row) throw notFound()
    return row
  }
  async function read(tx: Tx, actor: CrmActor, id: string): Promise<ParticipantEditorData> {
    const row = await source(tx, actor, id)
    const saved = await tx.crmOpportunityParticipant.findMany({ where: { tenantId: actor.tenantId, opportunityId: id }, orderBy: [...participantOrder] })
    const canChoosePerson = permits(actor, "contacts.read"), canChooseBusiness = permits(actor, "accounts.read")
    const [people, businesses, editable] = await Promise.all([
      canChoosePerson && saved.some(item => item.contactId) ? tx.crmContact.findMany({ where: { ...contactScope(actor), archived: false, id: { in: saved.flatMap(item => item.contactId ? [item.contactId] : []) } }, select: { id: true } }) : [],
      canChooseBusiness && saved.some(item => item.accountId) ? tx.crmAccount.findMany({ where: { ...accountScope(actor), archived: false, id: { in: saved.flatMap(item => item.accountId ? [item.accountId] : []) } }, select: { id: true } }) : [],
      permits(actor, "opportunities.edit") ? tx.crmOpportunity.findFirst({ where: { ...opportunityScope(actor, "edit"), id }, select: { id: true } }) : null,
    ])
    const eligible = new Set([...people.map(item => `PERSON:${item.id}`), ...businesses.map(item => `BUSINESS:${item.id}`)])
    return { version: row.version, primary: crmQuotationParticipants({ tenantId: actor.tenantId, person: row.contact, business: row.account }).participants, participants: saved.map(item => {
      const participant = savedParticipant(item)
      return { ...participant, available: eligible.has(`${participant.party.kind}:${participant.party.id}`) }
    }), canEdit: !!editable, canChoosePerson, canChooseBusiness }
  }
  async function configuration(tx: Tx, actor: CrmActor) { return readParticipantConfiguration(tx, actor.tenantId, preset ? await preset(tx, actor) : genericParticipantPreset) }
  async function informationView(tx: Tx, actor: CrmActor, id: string) {
    const row = await source(tx, actor, id)
    const snapshot = await crmSourceParticipants(tx, id, { tenantId: actor.tenantId, person: row.contact, business: row.account, information: row.participantInformation })
    const config = await configuration(tx, actor)
    const canEdit = permits(actor, "opportunities.edit") && !!await tx.crmOpportunity.findFirst({ where: { ...opportunityScope(actor, "edit"), id }, select: { id: true } })
    return { version: row.version, configuration: config, participants: snapshot.participants, canEdit, missing: missingParticipantInformation(snapshot, config.definition) }
  }
  return {
    getOpportunityParticipantInformation(id: string) { return run("opportunities.read", (tx, actor) => informationView(tx, actor, id)) },
    saveOpportunityParticipantInformation(id: string, input: unknown) {
      const data = participantInformationSaveSchema.parse(input)
      return runLocked(["opportunities.read", "opportunities.edit"], async (tx, actor) => {
        await tx.$queryRaw`SELECT id FROM "CrmOpportunity" WHERE "tenantId"=${actor.tenantId} AND id=${id} FOR UPDATE`
        const row = await source(tx, actor, id, true), config = await configuration(tx, actor)
        if (row.version !== data.version || config.version !== data.configurationVersion) throw new BusinessError(409, "The opportunity or customer detail requirements changed. Reload before saving; your draft is retained.")
        const snapshot = await crmSourceParticipants(tx, id, { tenantId: actor.tenantId, person: row.contact, business: row.account })
        const allowed = new Set(snapshot.participants.map(item => informationPartyKey(item.party)))
        if (data.information.records.some(item => !allowed.has(informationPartyKey(item.party)))) throw new BusinessError(409, "Save details only for this opportunity's current participants.")
        const updated = await tx.crmOpportunity.updateMany({ where: { ...opportunityScope(actor, "edit"), id, version: data.version }, data: { participantInformation: data.information, version: { increment: 1 } } })
        if (!updated.count) throw new BusinessError(409, "This opportunity changed. Reload before saving.")
        await audit(tx, actor, "crm.opportunity.information.updated", id, { version: data.version }, { version: data.version + 1, configurationVersion: config.version, parties: data.information.records.map(item => item.party) })
        await tx.crmOpportunityActivity.createMany({ data: { tenantId: actor.tenantId, opportunityId: id, actorUserId: actor.userId, event: "crm.opportunity.information.updated", message: "Customer correspondence details updated." } })
        return informationView(tx, actor, id)
      })
    },
    getOpportunityParticipants(id: string) { return run("opportunities.read", (tx, actor) => read(tx, actor, id)) },
    listOpportunityParticipantChoices(id: string, input: unknown) {
      const query = querySchema.parse(input)
      return run(["opportunities.read", "opportunities.edit"], async (tx, actor) => {
        await source(tx, actor, id, true)
        requirePermission(actor, query.kind === "PERSON" ? "contacts.read" : "accounts.read")
        const bounds = { archived: false, name: { contains: query.q, mode: "insensitive" as const } }
        const paging = { orderBy: [{ name: "asc" as const }, { id: "asc" as const }], skip: (query.page - 1) * query.pageSize, take: query.pageSize, select: { id: true, name: true } }
        if (query.kind === "PERSON") {
          const where = { ...contactScope(actor), ...bounds }
          const [items, total, selected] = await Promise.all([tx.crmContact.findMany({ where, ...paging }), tx.crmContact.count({ where }), query.selectedId ? tx.crmContact.findFirst({ where: { ...where, id: query.selectedId }, select: paging.select }) : null])
          return { items, total, page: query.page, pageSize: query.pageSize, totalPages: Math.max(1, Math.ceil(total / query.pageSize)), selected }
        }
        const where = { ...accountScope(actor), ...bounds }
        const [items, total, selected] = await Promise.all([tx.crmAccount.findMany({ where, ...paging }), tx.crmAccount.count({ where }), query.selectedId ? tx.crmAccount.findFirst({ where: { ...where, id: query.selectedId }, select: paging.select }) : null])
        return { items, total, page: query.page, pageSize: query.pageSize, totalPages: Math.max(1, Math.ceil(total / query.pageSize)), selected }
      })
    },
    replaceOpportunityParticipants(id: string, input: unknown) {
      const data = participantReplacementSchema.parse(input)
      return runLocked(["opportunities.read", "opportunities.edit"], async (tx, actor) => {
        await tx.$queryRaw`SELECT id FROM "CrmOpportunity" WHERE "tenantId"=${actor.tenantId} AND id=${id} FOR UPDATE`
        const row = await source(tx, actor, id, true)
        if (row.version !== data.version) throw new BusinessError(409, "This opportunity changed. Reload participants before saving. Your draft has not been saved.")
        const previous = await tx.crmOpportunityParticipant.findMany({ where: { tenantId: actor.tenantId, opportunityId: id }, orderBy: [...participantOrder] })
        const retained = new Map(previous.map(item => [participantKey(savedParticipant(item)), item]))
        // Resolve the complete new/refresh population in two scoped queries.
        const changed = data.participants.filter(item => item.refresh || !retained.has(participantKey(item)))
        if (changed.some(item => item.party.kind === "PERSON")) requirePermission(actor, "contacts.read")
        if (changed.some(item => item.party.kind === "BUSINESS")) requirePermission(actor, "accounts.read")
        const [people, businesses] = await Promise.all([
          changed.some(item => item.party.kind === "PERSON") ? tx.crmContact.findMany({ where: { ...contactScope(actor), archived: false, id: { in: changed.filter(item => item.party.kind === "PERSON").map(item => item.party.id) } }, select: personSelect }) : [],
          changed.some(item => item.party.kind === "BUSINESS") ? tx.crmAccount.findMany({ where: { ...accountScope(actor), archived: false, id: { in: changed.filter(item => item.party.kind === "BUSINESS").map(item => item.party.id) } }, select: businessSelect }) : [],
        ])
        const rows = data.participants.map(item => {
          const old = retained.get(participantKey(item))
          if (old && !item.refresh) return savedParticipant(old)
          const person = item.party.kind === "PERSON" ? people.find(p => p.id === item.party.id) : null
          const business = item.party.kind === "BUSINESS" ? businesses.find(p => p.id === item.party.id) : null
          const party = person || business
          if (!party) throw new BusinessError(409, "A selected participant is unavailable. Choose an accessible active contact or business, or retain its saved selection.")
          return { role: item.role, party: { kind: item.party.kind, id: party.id, name: party.name, email: person?.email ?? null, phone: person?.phone ?? null, sourceVersion: party.version } }
        })
        const accepted = combineParticipants({ tenantId: actor.tenantId, person: row.contact, business: row.account }, rows)
        const updated = await tx.crmOpportunity.updateMany({ where: { ...opportunityScope(actor, "edit"), id, version: data.version }, data: { participantInformation: pruneParticipantInformation(row.participantInformation, accepted), version: { increment: 1 } } })
        if (!updated.count) throw new BusinessError(409, "This opportunity changed. Reload participants before saving.")
        await tx.crmOpportunityParticipant.deleteMany({ where: { tenantId: actor.tenantId, opportunityId: id } })
        if (rows.length) await tx.crmOpportunityParticipant.createMany({ data: rows.map((item, position) => ({ id: retained.get(participantKey(item))?.id, tenantId: actor.tenantId, opportunityId: id, role: item.role, contactId: item.party.kind === "PERSON" ? item.party.id : null, accountId: item.party.kind === "BUSINESS" ? item.party.id : null, position, details: evidence(item) })) })
        const refs = (items: ParticipantSnapshot["participants"]) => items.map(item => ({ role: item.role, kind: item.party.kind, id: item.party.id, sourceVersion: item.party.sourceVersion }))
        await audit(tx, actor, "crm.opportunity.participants.updated", id, { version: data.version, participants: refs(previous.map(savedParticipant)) }, { version: data.version + 1, participants: refs(rows) })
        await tx.crmOpportunityActivity.createMany({ data: { tenantId: actor.tenantId, opportunityId: id, actorUserId: actor.userId, event: "crm.opportunity.participants.updated", message: `Saved ${rows.length} additional participant${rows.length === 1 ? "" : "s"}.` } })
        return read(tx, actor, id)
      })
    },
  }
}
