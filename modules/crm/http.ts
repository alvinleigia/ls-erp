import { prisma } from "@/lib/prisma"
import { withBusinessApi } from "@/platform/business-api"
import { createCrmService } from "./service"

export const queryInput = (request: Request) => Object.fromEntries(new URL(request.url).searchParams)
export function withCrmApi(request: Request, handler: (service: ReturnType<typeof createCrmService>) => Promise<unknown>, status = 200) {
  return withBusinessApi(request, actor => handler(createCrmService(prisma, actor)), status)
}
