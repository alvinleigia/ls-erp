import type { Prisma } from "@prisma/client"
import type { BusinessActor } from "@/platform/policy"
import { realEstateEnabled } from "./sales-context"
import { defaultTermResolver } from "@/platform/terminology/resolver"

// Called only after the document service resolves an accessible opportunity,
// inside the same transaction. Saved revisions retain their original context.
export async function realEstateQuotationContext(tx: Prisma.TransactionClient, actor: BusinessActor, opportunityId: string, term = defaultTermResolver) {
  if (!await realEstateEnabled(tx, actor.tenantId)) return []
  const context = await tx.realEstateOpportunityContext.findFirst({ where: { tenantId: actor.tenantId, opportunityId }, include: { project: { select: { name: true, developerAccount: { select: { name: true } } } }, subproject: { select: { name: true } } } })
  return [
    { label: term("realEstate.project.singular", "Project"), value: context?.project?.name || "" },
    { label: term("realEstate.subproject.singular", "Subproject"), value: context?.subproject?.name || "" },
    { label: "Developer", value: context?.project?.developerAccount?.name || "" },
  ].filter(item => item.value)
}
