import { prisma } from "@/lib/prisma"
import { withBusinessApi } from "@/platform/business-api"
import { createCollaboratorService } from "./service"
export const collaboratorQuery = (request: Request) => Object.fromEntries(new URL(request.url).searchParams)
export function withCollaboratorApi(request: Request, work: (service: ReturnType<typeof createCollaboratorService>) => Promise<unknown>, status = 200) {
  return withBusinessApi(request, actor => work(createCollaboratorService(prisma, actor)), status)
}
