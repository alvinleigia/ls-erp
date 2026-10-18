import { prisma } from "@/lib/prisma"
import { withBusinessApi } from "@/platform/business-api"
import { createRealEstateService } from "./service"
import { createTermErrorPresenter } from "@/platform/terminology/error-presentation"
import { realEstateTerms } from "./terminology"
import { crmTerms } from "@/modules/crm/terminology"
const presentError = createTermErrorPresenter(prisma, [...crmTerms, ...realEstateTerms])
export function withRealEstateApi(request: Request, handler: (service: ReturnType<typeof createRealEstateService>) => Promise<unknown>, status = 200) {
  return withBusinessApi(request, actor => handler(createRealEstateService(prisma, actor)), status, presentError)
}
