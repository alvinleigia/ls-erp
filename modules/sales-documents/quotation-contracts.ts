import type { Prisma } from "@prisma/client"
import type { BusinessActor } from "@/platform/policy"
import type { PermissionRun } from "@/platform/access/server"
import type { TermReader } from "@/platform/terminology/read"
import type { TermResolver } from "@/platform/terminology/resolver"
import type { QuotationContent } from "./quotation-validation"
import type { CustomerParticipantSource, ParticipantSnapshot } from "@/platform/participants/validation"

export type DocumentContext = { label: string; value: string }[]
export type QuotationItemReference = { itemId: string; version: number; code: string; name: string; kind: string; currency: string }

// Application composition supplies the existing checked transaction and CRM
// record scope. No unrelated CRM queries, imports or extension hooks are needed.
export type QuotationDependencies = {
  run: PermissionRun
  audit: (tx: Prisma.TransactionClient, actor: BusinessActor, event: string, id: string, before?: Prisma.InputJsonValue, after?: Prisma.InputJsonValue) => Promise<void>
  opportunityScope: (actor: BusinessActor) => Prisma.CrmOpportunityWhereInput
  readTerms?: TermReader
  resolveItems?: (tx: Prisma.TransactionClient, actor: BusinessActor, content: QuotationContent, previous: QuotationItemReference[]) => Promise<QuotationItemReference[]>
  documentContext?: (tx: Prisma.TransactionClient, actor: BusinessActor, opportunityId: string, term?: TermResolver) => Promise<DocumentContext>
  participants?: (tx: Prisma.TransactionClient, opportunityId: string, source: CustomerParticipantSource) => Promise<ParticipantSnapshot>
}
