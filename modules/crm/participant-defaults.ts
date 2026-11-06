import type { Prisma } from "@prisma/client"
import { permits } from "@/platform/access/policy"
import { correspondenceSchema, informationFields } from "@/platform/participants/information"
import type { ParticipantInformation, ParticipantPartyReference } from "@/platform/participants/validation"
import { contactScope, type CrmActor } from "./policy"

// Directory defaults require their own current Read authority. Opportunity
// access alone must never disclose a contact's private correspondence.
export async function contactInformationDefaults(tx: Prisma.TransactionClient, actor: CrmActor, parties: ParticipantPartyReference[]): Promise<ParticipantInformation> {
  const ids = [...new Set(parties.filter(party => party.kind === "PERSON").map(party => party.id))]
  if (!ids.length || !permits(actor, "contacts.read")) return { format: 1, records: [] }
  const contacts = await tx.crmContact.findMany({ where: { ...contactScope(actor), archived: false, id: { in: ids } }, select: { id: true, email: true, phone: true, addressLine1: true, addressLine2: true, city: true, region: true, postalCode: true, country: true } })
  return { format: 1, records: contacts.flatMap(contact => {
    // Invalid old directory values cannot block creation or enter a new snapshot.
    const values = correspondenceSchema.parse(Object.fromEntries(informationFields.map(field => {
      const parsed = correspondenceSchema.shape[field].safeParse(contact[field] ?? "")
      return [field, parsed.success ? parsed.data : ""]
    })))
    return Object.values(values).some(Boolean) ? [{ party: { kind: "PERSON" as const, id: contact.id }, values }] : []
  }) }
}
