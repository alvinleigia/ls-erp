import { prisma } from "@/lib/prisma"
import { withBusinessApi } from "@/platform/business-api"
import { createRealEstateService } from "./service"
export function withRealEstateApi(request: Request, handler: (service: ReturnType<typeof createRealEstateService>) => Promise<unknown>, status = 200) {
  return withBusinessApi(request, actor => handler(createRealEstateService(prisma, actor)), status)
}
