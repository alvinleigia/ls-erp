import { participantSnapshotSchema, participantRoleLabels, type ParticipantRole } from "./validation"
import { defaultInformation } from "./requirements"
import type { DocumentBlock } from "../documents/contracts"
import { BusinessError } from "../policy"
export function participantDocumentBlocks(value: unknown, captions?: Record<ParticipantRole,string>): DocumentBlock[] {
  const parsed=participantSnapshotSchema.safeParse(value)
  if(!parsed.success)throw new BusinessError(409,"This saved revision has no complete participant evidence. Correct the source and use a replacement quotation/order.")
  const roleLabels=captions??parsed.data.presentation?.roleLabels??participantRoleLabels
  const grouped=new Map<string,{name:string;roles:Set<string>;information:ReturnType<typeof defaultInformation>}>()
  for(const row of parsed.data.participants){const key=JSON.stringify([row.party.kind,row.party.id]),previous=grouped.get(key);if(previous){previous.roles.add(roleLabels[row.role]);continue}grouped.set(key,{name:row.party.name,roles:new Set([roleLabels[row.role]]),information:row.information??defaultInformation(row)})}
  return [...grouped.values()].map(row=>({title:row.name,paragraphs:[[...row.roles].join(", "),[row.information.addressLine1,row.information.addressLine2,[row.information.city,row.information.region,row.information.postalCode].filter(Boolean).join(", "),row.information.country].filter(Boolean).join("\n"),[row.information.email,row.information.phone].filter(Boolean).join(" | ")].filter(Boolean)}))
}
