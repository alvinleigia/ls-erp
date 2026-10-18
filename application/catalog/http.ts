import { prisma } from "@/lib/prisma"
import { withBusinessApi } from "@/platform/business-api"
import { applicationCatalog } from "./service"
export function withCatalogApi(request: Request, handler: (service: ReturnType<typeof applicationCatalog>) => Promise<unknown>, status = 200) {
  return withBusinessApi(request, actor => handler(applicationCatalog(prisma, actor)), status)
}
