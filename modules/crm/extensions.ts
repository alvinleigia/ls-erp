import { Prisma } from "@prisma/client"
import { CrmError, type CrmActor } from "./policy"
import type { ImportField } from "./import-types"
import type { SalesReportLabel, SalesReportGrouping } from "@/types/crm-sales-report"

export type CrmRecordKind = "enquiry" | "opportunity"
type Tx = Prisma.TransactionClient
export type CrmExtensionQuery = Record<string, unknown>
export type CrmExportFields = { headers: string[]; terminologyKeys?: string[]; values: Record<string, (string | number | boolean | null)[]> }
export type CrmExtensionFilters = {
  enquiry?: Prisma.CrmEnquiryWhereInput
  opportunity?: Prisma.CrmOpportunityWhereInput
  work?: Prisma.CrmTaskWhereInput
}

// SQL descriptors are supplied by installed code, never by request data.
// Extension-owned joins use r as the scoped record and must remain one-to-one.
export type CrmReportDimension = SalesReportGrouping & { value: Prisma.Sql; display: Prisma.Sql }
export type CrmReportExtension = {
  values: Prisma.Sql
  columns: SalesReportLabel[]
  dimensions: CrmReportDimension[]
  enquiryJoins: Prisma.Sql
  opportunityJoins: Prisma.Sql
  filter: Prisma.Sql
}
export const emptyReportExtension: CrmReportExtension = {
  values: Prisma.sql`'{}'::jsonb`, columns: [], dimensions: [],
  enquiryJoins: Prisma.empty, opportunityJoins: Prisma.empty, filter: Prisma.empty,
}

// Application composition injects an implementation. Core CRM never selects an
// industry. All hooks receive the existing transaction and freshly checked actor.
export interface CrmExtensions<Fields extends object = object, Metadata extends object = object> {
  collectionContext?(tx: Tx, actor: CrmActor, orderId: string, creating: boolean): Promise<{ contactId: string; opportunityId: string; title: string; canCreate: boolean }>
  splitQuery(input: unknown): { core: unknown; extension: CrmExtensionQuery }
  importFields?(tx: Tx, actor: CrmActor): Promise<ImportField[]>
  importInput?(values: Record<string, unknown>): object
  validateCreate?(tx: Tx, actor: CrmActor, extension: unknown): Promise<void>
  splitWrite(input: unknown): { core: unknown; extension: unknown }
  assertConversionInput(extension: unknown): void
  save(tx: Tx, actor: CrmActor, kind: CrmRecordKind, id: string, extension: unknown): Promise<void>
  copyOnConversion(tx: Tx, actor: CrmActor, enquiryId: string, opportunityId: string): Promise<void>
  decorate<T extends { id: string }>(tx: Tx, actor: CrmActor, kind: CrmRecordKind, records: T[], exporting?: boolean): Promise<{ items: (T & Fields)[]; metadata: Metadata; exportFields?: CrmExportFields }>
  filters(tx: Tx, actor: CrmActor, query: CrmExtensionQuery): Promise<CrmExtensionFilters>
  report(tx: Tx, actor: CrmActor, query: CrmExtensionQuery): Promise<CrmReportExtension>
  choices(tx: Tx, actor: CrmActor, key: string, input: unknown): Promise<{ items: { id: string; name: string; code?: string; archived: boolean }[]; total: number; page: number; pageSize: number; totalPages: number }>
}

function rejectUnavailableFilter(query: CrmExtensionQuery) {
  if (Object.keys(query).length) throw new CrmError(403, "This CRM extension is not available.")
}

export const noCrmExtensions: CrmExtensions = {
  splitQuery: core => ({ core, extension: {} }),
  splitWrite: core => ({ core, extension: undefined }),
  assertConversionInput() {},
  async save() {},
  async copyOnConversion() {},
  async decorate(_tx, _actor, _kind, items) { return { items, metadata: {} } },
  async filters(_tx, _actor, query) { rejectUnavailableFilter(query); return {} },
  async report(_tx, _actor, query) { rejectUnavailableFilter(query); return emptyReportExtension },
  async choices() { throw new CrmError(404, "This CRM extension is not available.") },
}
