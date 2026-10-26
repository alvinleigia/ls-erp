import { prisma } from "@/lib/prisma"
import { requireBusinessModule } from "@/platform/module-server"
import { withBusinessApi } from "@/platform/business-api"
import { staffChoicesSchema, workforceStaffChoices } from "@/modules/workforce/staff-choices"

export function GET(request: Request) {
  return withBusinessApi(request, async actor => {
    await requireBusinessModule(prisma, actor.tenantId, "shifts")
    return workforceStaffChoices(actor, staffChoicesSchema.parse(Object.fromEntries(new URL(request.url).searchParams)))
  })
}
