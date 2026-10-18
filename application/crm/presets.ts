import type { CrmPreset } from "@/modules/crm/preset-service"
import { generalSalesPreset } from "@/modules/crm/presets"
import { realEstateSalesPreset } from "@/modules/real-estate/preset"

// Explicit installation; stable item identities preserve existing tenant choices.
export const crmPresets: readonly CrmPreset[] = [generalSalesPreset, realEstateSalesPreset]
