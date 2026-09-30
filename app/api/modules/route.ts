import { updateBusinessModule } from "@/platform/module-service"
import { prisma } from "@/lib/prisma"
import { moduleSettings } from "@/platform/modules"
import { readJson, withBusinessApi } from "@/platform/business-api"

export const dynamic = "force-dynamic"

export function GET(request: Request) {
  return withBusinessApi(request, async actor => {
    const configured = await prisma.tenantModule.findMany({ where: { tenantId: actor.tenantId } })
    return {
      canManage: actor.role === "ADMIN",
      permissions: actor.permissions ?? null,
      modules: moduleSettings(configured),
    }
  })
}

export function PATCH(request: Request) {
  return withBusinessApi(request, async actor => updateBusinessModule(prisma, actor, await readJson(request)))
}
