import { createCatalogService } from "@/modules/catalog/service"
import { propertyCatalogExtension } from "@/modules/real-estate/catalog-extension"
import type { PrismaClient } from "@prisma/client"
import type { BusinessActor } from "@/platform/policy"
export const catalogExtensions = [propertyCatalogExtension]
export const applicationCatalog = (db: PrismaClient, actor: Pick<BusinessActor, "tenantId" | "userId" | "requestId">) => createCatalogService(db, actor, catalogExtensions)
