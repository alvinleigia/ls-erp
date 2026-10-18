import type { CrmPreset, PresetItem } from "@/modules/crm/preset-service"
import { presetSource, presetField, presetActivity } from "@/modules/crm/presets"

const category = (name: string): PresetItem => ({
  resource: "projectSettings", key: `category.${name}`, label: name, description: "Property category for projects and buyer requirements.",
  inspect: (tx, tenantId, id) => tx.realEstatePropertyCategory.findFirst({ where: { tenantId, OR: [{ id }, { nameKey: name.toLowerCase() }] } }),
  create: (tx, tenantId, id) => tx.realEstatePropertyCategory.create({ data: { id, tenantId, name, nameKey: name.toLowerCase() } }),
})

export const realEstateSalesPreset: CrmPreset = { id: "real-estate-sales", name: "Real Estate sales", version: 1, module: "realEstate", items: [presetSource("Property portal"), presetSource("Channel partner"), category("Plot"), category("Apartment"), presetField("preferred_locality", "Preferred locality"), presetActivity("Site Visit", "MEETING", "Confirm the visit, review requirements and record the outcome.")] }
