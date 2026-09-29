import { crmPresets } from "./presets"
import type { PrismaClient } from "@prisma/client"
import type { CrmActor } from "@/modules/crm/policy"
import { createCrmService } from "@/modules/crm/service"
import { realEstateCrmExtension } from "@/modules/real-estate/crm-extension"

// The application installs extensions; each implementation checks the tenant's
// current module state inside the transaction. No process-wide tenant cache.
export function createApplicationCrmService(db: PrismaClient, actor: Pick<CrmActor, "tenantId" | "userId" | "requestId">) {
  return createCrmService(db, actor, realEstateCrmExtension, crmPresets)
}
