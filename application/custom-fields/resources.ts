import { registerFieldResources } from "@/platform/custom-fields/resources"
import { enquiryFields, opportunityFields } from "@/modules/crm/custom-fields"
import { projectFields } from "@/modules/real-estate/custom-fields"

export const customFieldResources = registerFieldResources([enquiryFields, opportunityFields, projectFields])
