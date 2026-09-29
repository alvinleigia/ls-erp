import { prisma } from "@/lib/prisma"
import { withBusinessApi } from "@/platform/business-api"
import { createApplicationCrmService } from "./service"

export const queryInput = (request: Request) => Object.fromEntries(new URL(request.url).searchParams)
export function withCrmApi(request: Request, handler: (service: ReturnType<typeof createApplicationCrmService>) => Promise<unknown>, status = 200) {
  return withBusinessApi(request, actor => handler(createApplicationCrmService(prisma, actor)), status)
}
