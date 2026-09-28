import { updateBusinessModule } from "@/platform/module-service"
import { prisma } from "@/lib/prisma"
import { businessModules } from "@/platform/modules"
import { readJson, withBusinessApi } from "@/platform/business-api"

export const dynamic = "force-dynamic"

export function GET(request: Request) {
  return withBusinessApi(request, async actor => {
    const configured = await prisma.tenantModule.findMany({ where: { tenantId: actor.tenantId } })
    return {
      canManage: actor.role === "ADMIN",
      modules: Object.entries(businessModules).map(([key, module]) => ({
        key, ...module, enabled: configured.find(row => row.key === key)?.enabled ?? module.defaultEnabled,
      })),
    }
  })
}

export function PATCH(request: Request) {
  return withBusinessApi(request, async actor => updateBusinessModule(prisma, actor, await readJson(request)))
}
