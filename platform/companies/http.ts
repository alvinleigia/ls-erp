import { prisma } from "@/lib/prisma"
import { withBusinessApi } from "@/platform/business-api"
import { createCompanyService } from "./service"

export function withCompanyApi(request: Request, handler: (service: ReturnType<typeof createCompanyService>) => Promise<unknown>, status = 200) {
  return withBusinessApi(request, actor => handler(createCompanyService(prisma, actor)), status)
}
export const structureQuery = (request: Request) => Object.fromEntries(new URL(request.url).searchParams)
