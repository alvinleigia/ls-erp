import type { Prisma } from "@prisma/client"
import { permits } from "@/platform/access/policy"
import { correspondenceSchema, informationFields } from "@/platform/participants/information"
import type { ParticipantInformation, ParticipantPartyReference } from "@/platform/participants/validation"
import { contactScope, accountScope, type CrmActor } from "./policy"
import { addressOwnerWhere } from "@/platform/addresses/service"
import { BusinessError } from "@/platform/policy"
import { informationPartyKey } from "@/platform/participants/information"

// Directory defaults require their own current Read authority. Opportunity
// access alone must never disclose a contact's private correspondence.
export async function contactInformationDefaults(tx: Prisma.TransactionClient, actor: CrmActor, parties: ParticipantPartyReference[]): Promise<ParticipantInformation> {
  const ids = [...new Set(parties.filter(party => party.kind === "PERSON").map(party => party.id))], businessIds = [...new Set(parties.filter(party => party.kind === "BUSINESS").map(party => party.id))]
  const contacts = ids.length && permits(actor, "contacts.read") ? await tx.crmContact.findMany({ where: { ...contactScope(actor), archived: false, id: { in: ids } }, select: { id: true, email: true, phone: true, addressLine1: true, addressLine2: true, city: true, region: true, postalCode: true, country: true } }) : []
  const businesses = businessIds.length && permits(actor, "accounts.read") ? await tx.crmAccount.findMany({ where: { ...accountScope(actor), archived: false, id: { in: businessIds } }, select: { id: true } }) : []
  const owners = [...contacts.map(row => ({ kind: "PERSON" as const, id: row.id })), ...businesses.map(row => ({ kind: "BUSINESS" as const, id: row.id }))]
  if (!owners.length) return { format: 1, records: [] }
  const addresses = await tx.partyAddress.findMany({ where: { tenantId: actor.tenantId, archived: false, AND: [{ OR: owners.map(addressOwnerWhere) }, { OR: [{ defaultCorrespondence: true }, { defaultBilling: true }, { defaultDelivery: true }] }] } })
  return { format: 1, records: owners.flatMap(owner => {
    const contact = owner.kind === "PERSON" ? contacts.find(row => row.id === owner.id) : undefined
    // Invalid old directory values cannot block creation or enter a new snapshot.
    const values = correspondenceSchema.parse(Object.fromEntries(informationFields.map(field => {
      const parsed = correspondenceSchema.shape[field].safeParse(contact?.[field] ?? "")
      return [field, parsed.success ? parsed.data : ""]
    })))
    const own = addresses.filter(row => owner.kind === "PERSON" ? row.contactId === owner.id : row.accountId === owner.id)
    const record: ParticipantInformation["records"][number] = { party: owner, values }
    for (const [flag, purpose] of [["defaultCorrespondence", "correspondence"], ["defaultBilling", "billing"], ["defaultDelivery", "delivery"]] as const) {
      const address = own.find(row => row[flag])
      if (!address) continue
      const accepted = correspondenceSchema.parse(address.values)
      if (purpose === "correspondence") record.values = accepted
      else record.addresses = { ...record.addresses, [purpose]: accepted }
      record.addressReferences = { ...record.addressReferences, [purpose]: { id: address.id, version: address.version } }
    }
    return Object.values(record.values).some(Boolean) || record.addresses ? [record] : []
  }) }
}

export async function participantAddressBooks(tx: Prisma.TransactionClient, actor: CrmActor, parties: ParticipantPartyReference[]) {
  const ids = [...new Set(parties.filter(row => row.kind === "PERSON").map(row => row.id))], businessIds = [...new Set(parties.filter(row => row.kind === "BUSINESS").map(row => row.id))]
  const [people, businesses] = await Promise.all([
    ids.length && permits(actor, "contacts.read") ? tx.crmContact.findMany({ where: { ...contactScope(actor), archived: false, id: { in: ids } }, select: { id: true } }) : [],
    businessIds.length && permits(actor, "accounts.read") ? tx.crmAccount.findMany({ where: { ...accountScope(actor), archived: false, id: { in: businessIds } }, select: { id: true } }) : [],
  ])
  return [...people.map(row => ({ party: { kind: "PERSON" as const, id: row.id }, endpoint: `/api/crm/contacts/${row.id}/addresses` })), ...businesses.map(row => ({ party: { kind: "BUSINESS" as const, id: row.id }, endpoint: `/api/crm/accounts/${row.id}/addresses` }))]
}

// New selections are resolved under current directory authority and version.
// An unchanged reference retains its accepted values, even after archive or access
// revocation. Editing those values turns it into a manual transaction address.
export async function resolveParticipantAddressSelections(tx: Prisma.TransactionClient, actor: CrmActor, incoming: ParticipantInformation, previous: ParticipantInformation | undefined) {
  if (!incoming.records.some(row => Object.values(row.addressReferences ?? {}).some(Boolean))) return incoming
  const books = await participantAddressBooks(tx, actor, incoming.records.map(row => row.party))
  const result = structuredClone(incoming)
  for (const record of result.records) {
    const saved = previous?.records.find(row => informationPartyKey(row.party) === informationPartyKey(record.party))
    for (const purpose of ["correspondence", "billing", "delivery"] as const) {
      const reference = record.addressReferences?.[purpose]
      if (!reference) continue
      const retained = saved?.addressReferences?.[purpose]
      const values = purpose === "correspondence" ? record.values : record.addresses?.[purpose], old = purpose === "correspondence" ? saved?.values : saved?.addresses?.[purpose]
      if (retained?.id === reference.id && retained.version === reference.version) {
        if (JSON.stringify(values) !== JSON.stringify(old)) delete record.addressReferences![purpose]
        continue
      }
      if (!books.some(book => informationPartyKey(book.party) === informationPartyKey(record.party))) throw new BusinessError(403, "Current directory Read access is required to select an address.")
      await tx.$queryRaw`SELECT id FROM "PartyAddress" WHERE "tenantId"=${actor.tenantId} AND id=${reference.id} FOR SHARE`
      const address = await tx.partyAddress.findFirst({ where: { tenantId: actor.tenantId, ...addressOwnerWhere(record.party), id: reference.id, archived: false, purposes: { has: purpose.toUpperCase() } } })
      if (!address || address.version !== reference.version) throw new BusinessError(409, "A selected address changed or is unavailable. Choose it again before saving; your draft is retained.")
      const accepted = correspondenceSchema.parse(address.values)
      if (purpose === "correspondence") record.values = accepted
      else record.addresses = { ...record.addresses, [purpose]: accepted }
    }
  }
  return result
}
