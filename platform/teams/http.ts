import { prisma } from "@/lib/prisma"
import { withBusinessApi } from "@/platform/business-api"
import { createBusinessTeamService } from "./business-service"
export const queryInput = (request: Request) => Object.fromEntries(new URL(request.url).searchParams)
export function withTeamApi(request: Request, handler: (service: ReturnType<typeof createBusinessTeamService>) => Promise<unknown>, status = 200) {
  return withBusinessApi(request, actor => handler(createBusinessTeamService(prisma, actor)), status)
}
