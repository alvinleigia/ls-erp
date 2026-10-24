import { withBusinessApi, readJson } from "@/platform/business-api"
import { prisma } from "@/lib/prisma"
import { createRecordSharingService } from "@/platform/access/sharing-service"
type Params = { params: Promise<{ resource: string; id: string }> }
export async function GET(request: Request, context: Params) {
  const { resource, id } = await context.params
  return withBusinessApi(request, actor => createRecordSharingService(prisma, actor).get(resource, id))
}
export async function PATCH(request: Request, context: Params) {
  const { resource, id } = await context.params
  return withBusinessApi(request, async actor => createRecordSharingService(prisma, actor).save(resource, id, await readJson(request)))
}
