import { prisma } from "@/lib/prisma"
import { withBusinessApi } from "@/platform/business-api"
import { createCustomFieldService } from "@/platform/custom-fields/service"
import { customFieldResources } from "./resources"
import { createTermErrorPresenter } from "@/platform/terminology/error-presentation"
import { terminologyCatalog } from "@/application/terminology/catalog"
const presentError = createTermErrorPresenter(prisma, terminologyCatalog)
export function withCustomFieldApi(request: Request, handler: (service: ReturnType<typeof createCustomFieldService>) => Promise<unknown>, status = 200) {
  return withBusinessApi(request, actor => handler(createCustomFieldService(prisma, actor, customFieldResources)), status, presentError)
}
