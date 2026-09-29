import { Prisma } from "@prisma/client"
import { CrmError, type CrmActor } from "./policy"

export type CrmRecordKind = "enquiry" | "opportunity"
type Tx = Prisma.TransactionClient
export type CrmExtensionQuery = { projectId?: string; subprojectId?: string; dimension?: string }
export type CrmExtensionFilters = {
  enquiry?: Prisma.CrmEnquiryWhereInput
  opportunity?: Prisma.CrmOpportunityWhereInput
  work?: Prisma.CrmTaskWhereInput
}

// Stable report projection for existing clients. Extension-owned SQL uses r as
// the already-scoped CRM record; joins must be one-to-one and tenant-qualified.
export type CrmReportExtension = {
  columns: Prisma.Sql
  enquiryJoins: Prisma.Sql
  opportunityJoins: Prisma.Sql
  filter: Prisma.Sql
  realEstateEnabled: boolean
}
export const emptyReportExtension: CrmReportExtension = {
  columns: Prisma.sql`NULL::text AS "projectId", NULL::text AS project, NULL::text AS subproject`,
  enquiryJoins: Prisma.empty, opportunityJoins: Prisma.empty, filter: Prisma.empty,
  realEstateEnabled: false,
}

// Application composition injects an implementation. Core CRM never selects an
// industry. All hooks receive the existing transaction and freshly checked actor.
export interface CrmExtensions<Fields extends object = object, Metadata extends object = object> {
  splitWrite(input: unknown): { core: unknown; extension: unknown }
  assertConversionInput(extension: unknown): void
  save(tx: Tx, actor: CrmActor, kind: CrmRecordKind, id: string, extension: unknown): Promise<void>
  copyOnConversion(tx: Tx, actor: CrmActor, enquiryId: string, opportunityId: string): Promise<void>
  decorate<T extends { id: string }>(tx: Tx, actor: CrmActor, kind: CrmRecordKind, records: T[]): Promise<{ items: (T & Fields)[]; metadata: Metadata }>
  filters(tx: Tx, actor: CrmActor, query: CrmExtensionQuery): Promise<CrmExtensionFilters>
  report(tx: Tx, actor: CrmActor, query: CrmExtensionQuery): Promise<CrmReportExtension>
  choices(tx: Tx, actor: CrmActor, key: string, input: unknown): Promise<{ items: { id: string; name: string; code?: string; archived: boolean }[]; total: number; page: number; pageSize: number; totalPages: number }>
}

function rejectUnavailableFilter(query: CrmExtensionQuery) {
  if (query.projectId || query.subprojectId || query.dimension === "project") throw new CrmError(403, "This CRM extension is not available.")
}

export const noCrmExtensions: CrmExtensions = {
  splitWrite: core => ({ core, extension: undefined }),
  assertConversionInput() {},
  async save() {},
  async copyOnConversion() {},
  async decorate(_tx, _actor, _kind, items) { return { items, metadata: {} } },
  async filters(_tx, _actor, query) { rejectUnavailableFilter(query); return {} },
  async report(_tx, _actor, query) { rejectUnavailableFilter(query); return emptyReportExtension },
  async choices() { throw new CrmError(404, "This CRM extension is not available.") },
}
