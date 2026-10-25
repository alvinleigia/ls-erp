import { prisma } from "@/lib/prisma"
import { withBusinessApi } from "@/platform/business-api"
import { createOfficeAccessService } from "./office-access"
export function withOfficeAccessApi(request: Request, handler: (service: ReturnType<typeof createOfficeAccessService>) => Promise<unknown>) {
  return withBusinessApi(request, actor => handler(createOfficeAccessService(prisma, actor)))
}
