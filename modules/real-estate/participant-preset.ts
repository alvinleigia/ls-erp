import type { ParticipantPresetReader } from "@/platform/participants/configuration"
import { genericParticipantPreset } from "@/platform/participants/requirements"
import { moduleEnabled } from "@/platform/modules"

export const realEstateParticipantPreset: ParticipantPresetReader = async (tx, actor) => {
  const flags = await tx.tenantModule.findMany({ where: { tenantId: actor.tenantId }, select: { key: true, allowed: true, enabled: true } })
  return moduleEnabled(flags, "realEstate") ? { id: "real-estate-customer-information", version: 1, title: "Customer information (CIF)", roleLabels: { CUSTOMER: "Primary applicant", ADDITIONAL_CUSTOMER: "Co-applicant", REPRESENTATIVE: "Representative" } } : genericParticipantPreset
}
