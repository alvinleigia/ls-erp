import { buildParticipantSnapshot } from "@/platform/participants/snapshot"
import type { CustomerParticipantSource, ParticipantSelection, ResolvedParticipantParty } from "@/platform/participants/validation"

// Existing, authorized source relationships are evidence, not a new directory
// selection. Capture the person/business IDs now; never infer an old revision's
// customer from the opportunity's current contact when creating an order later.
export function crmQuotationParticipants({ tenantId, person: contact, business: account }: CustomerParticipantSource) {
  const person: ResolvedParticipantParty = {
    kind: "PERSON", id: contact.id, tenantId: contact.tenantId,
    name: contact.name, email: contact.email, phone: contact.phone, sourceVersion: contact.version,
  }
  const selections: ParticipantSelection[] = [{ role: account ? "REPRESENTATIVE" : "CUSTOMER", party: { kind: "PERSON", id: person.id } }]
  const parties: ResolvedParticipantParty[] = [person]
  if (account) {
    selections.unshift({ role: "CUSTOMER", party: { kind: "BUSINESS", id: account.id } })
    // Only the business name already exposed by the sales relationship is
    // captured; do not turn quotation access into business-directory disclosure.
    parties.push({ kind: "BUSINESS", id: account.id, tenantId: account.tenantId, name: account.name, email: null, phone: null, sourceVersion: account.version })
  }
  return buildParticipantSnapshot(tenantId, selections, parties)
}
