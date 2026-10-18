import type { Prisma } from "@prisma/client"
import type { BusinessActor } from "@/platform/policy"
import type { PermissionRun } from "@/platform/access/server"
import type { TermReader } from "@/platform/terminology/read"
import type { TermResolver } from "@/platform/terminology/resolver"

export type DocumentContext = { label: string; value: string }[]

// Application composition supplies the existing checked transaction and CRM
// record scope. No unrelated CRM queries, imports or extension hooks are needed.
export type QuotationDependencies = {
  run: PermissionRun
  audit: (tx: Prisma.TransactionClient, actor: BusinessActor, event: string, id: string, before?: Prisma.InputJsonValue, after?: Prisma.InputJsonValue) => Promise<void>
  opportunityScope: (actor: BusinessActor) => Prisma.CrmOpportunityWhereInput
  readTerms?: TermReader
  documentContext?: (tx: Prisma.TransactionClient, actor: BusinessActor, opportunityId: string, term?: TermResolver) => Promise<DocumentContext>
}
