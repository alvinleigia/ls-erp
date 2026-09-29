import { prisma } from "@/lib/prisma"
import { withBusinessApi } from "@/platform/business-api"
import { createCustomFieldService } from "@/platform/custom-fields/service"
import { enquiryFields, opportunityFields } from "@/modules/crm/custom-fields"
import { projectFields } from "@/modules/real-estate/custom-fields"
export const customFieldResources = [enquiryFields, opportunityFields, projectFields]
export function withCustomFieldApi(request: Request, handler: (service: ReturnType<typeof createCustomFieldService>) => Promise<unknown>, status = 200) {
  return withBusinessApi(request, actor => handler(createCustomFieldService(prisma, actor, customFieldResources)), status)
}
