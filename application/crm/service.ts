import { ownedRecordScope } from "@/platform/access/record-scope"
import { terminologyCatalog } from "@/application/terminology/catalog"
import { readTermReplacements } from "@/platform/terminology/read"
import { realEstateQuotationContext } from "@/modules/real-estate/quotation-context"
import { createQuotationService } from "@/modules/sales-documents/quotation-service"
import { crmPresets } from "./presets"
import type { PrismaClient } from "@prisma/client"
import { type CrmActor } from "@/modules/crm/policy"
import { createCrmService } from "@/modules/crm/service"
import { realEstateCrmExtension } from "@/modules/real-estate/crm-extension"
import { catalogQuotationItems } from "@/modules/catalog/quotation-items"
import { catalogExtensions } from "@/application/catalog/service"
import { collectionContext } from "@/application/receivables/collection-context"
import { crmSourceParticipants } from "@/modules/crm/participant-source"

// The application installs extensions; each implementation checks the tenant's
// current module state inside the transaction. No process-wide tenant cache.
export function createApplicationCrmService(db: PrismaClient, actor: Pick<CrmActor, "tenantId" | "userId" | "requestId">) {
  return createCrmService(db, actor, { ...realEstateCrmExtension, collectionContext }, crmPresets, context => createQuotationService({ ...context, opportunityScope: actor => ownedRecordScope(actor, "quotations"), resolveItems: catalogQuotationItems(catalogExtensions), documentContext: realEstateQuotationContext, participants: crmSourceParticipants, readTerms: (tx, identity) => readTermReplacements(tx, identity.tenantId, terminologyCatalog) }), terminologyCatalog)
}
