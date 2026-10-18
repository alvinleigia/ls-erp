import { prisma } from "@/lib/prisma"
import { readJson, withBusinessApi } from "@/platform/business-api"
import { createTerminologyService } from "@/platform/terminology/service"
import { terminologyCatalog } from "@/application/terminology/catalog"

export const dynamic = "force-dynamic"
export function GET(request: Request) {
  return withBusinessApi(request, actor => createTerminologyService(prisma, actor, terminologyCatalog).read())
}
export function PATCH(request: Request) {
  return withBusinessApi(request, async actor => createTerminologyService(prisma, actor, terminologyCatalog).update(await readJson(request)))
}
