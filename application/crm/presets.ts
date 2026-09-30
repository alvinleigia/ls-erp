import { Prisma } from "@prisma/client"
import type { CrmPreset, PresetItem } from "@/modules/crm/preset-service"
import { CrmError } from "@/modules/crm/policy"
import { fieldSchema } from "@/platform/custom-fields/validation"

const field = (code: string, name: string): PresetItem => ({
  resource: "customFields", key: `field.${code}`, label: name, description: "Optional text field on enquiries and opportunities; copied during conversion.",
  inspect: (tx, tenantId, id) => tx.customFieldDefinition.findFirst({ where: { tenantId, OR: [{ id }, { scope: "SALES", code }] } }),
  async create(tx, tenantId, id) {
    const count = await tx.customFieldDefinition.count({ where: { tenantId, scope: { in: ["SALES", "ENQUIRY", "OPPORTUNITY"] } } })
    // Conservative shared limit; the normal field editor can allocate remaining
    // per-resource capacity if enquiry/opportunity definitions differ.
    if (count >= 50) throw new CrmError(409, "Custom-field capacity reached. No preset changes were saved.")
    const { options: _options, version: _version, ...data } = fieldSchema.parse({ scope: "SALES", code, name, type: "TEXT" })
    void _options; void _version
    return tx.customFieldDefinition.create({ data: { ...data, defaultValue: Prisma.DbNull, tenantId, id } })
  },
})
const activity = (name: string, baseType: "MEETING" | "TASK", instructions: string): PresetItem => ({
  resource: "activityTypes", key: `activity.${name}`, label: name, description: `${baseType === "MEETING" ? "Meeting" : "Task"} activity: ${instructions}`,
  inspect: (tx, tenantId, id) => tx.crmActivityType.findFirst({ where: { tenantId, OR: [{ id }, { nameKey: name.toLowerCase() }] } }),
  create: (tx, tenantId, id) => tx.crmActivityType.create({ data: { id, tenantId, name, nameKey: name.toLowerCase(), baseType, defaultInstructions: instructions } }),
})
const source = (name: string): PresetItem => ({
  resource: "leadSources", key: `source.${name}`, label: name, description: "Lead source choice.",
  inspect: (tx, tenantId, id) => tx.crmLeadSource.findFirst({ where: { tenantId, OR: [{ id }, { nameKey: name.toLowerCase() }] } }),
  create: (tx, tenantId, id) => tx.crmLeadSource.create({ data: { id, tenantId, name, nameKey: name.toLowerCase() } }),
})
const category = (name: string): PresetItem => ({
  resource: "projectSettings", key: `category.${name}`, label: name, description: "Property category for projects and buyer requirements.",
  inspect: (tx, tenantId, id) => tx.realEstatePropertyCategory.findFirst({ where: { tenantId, OR: [{ id }, { nameKey: name.toLowerCase() }] } }),
  create: (tx, tenantId, id) => tx.realEstatePropertyCategory.create({ data: { id, tenantId, name, nameKey: name.toLowerCase() } }),
})
// Presets are explicit composition, not automatic tenant initialization. Stable
// item identities and matching codes/names protect renamed and archived choices.
export const crmPresets: readonly CrmPreset[] = [
  { id: "general-sales", name: "General sales", version: 1, module: "crm", items: [source("Referral"), source("Website"), field("purchase_requirements", "Purchase requirements"), activity("Proposal review", "TASK", "Review the proposal and agree the next step.")] },
  { id: "real-estate-sales", name: "Real Estate sales", version: 1, module: "realEstate", items: [source("Property portal"), source("Channel partner"), category("Plot"), category("Apartment"), field("preferred_locality", "Preferred locality"), activity("Site Visit", "MEETING", "Confirm the visit, review requirements and record the outcome.")] },
]
