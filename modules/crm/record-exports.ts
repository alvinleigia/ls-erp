import { createTermResolver, type TermResolver } from "@/platform/terminology/resolver"
import { crmCsv } from "./csv"
import type { CrmExportFields } from "./extensions"

type ExportPage<T> = { exportTerms?: Record<string, string>; items: T[]; extensionExport?: CrmExportFields; customFieldExport?: CrmExportFields }
type SalesRow = {
  id: string; title: string; contact: { name: string }; assignee: { name: string | null };
  salesTeam?: { name: string } | null; source: string | null; createdAt: Date; lostReasonName: string | null;
}
type EnquiryRow = SalesRow & { status: string; targetCloseOn: Date | null; outcome: string | null }
type OpportunityRow = SalesRow & {
  pipeline: { name: string }; stage: { name: string; kind: string }; amount: unknown; currency: string;
  expectedCloseOn: Date; closedAt: Date | null; lossReason: string | null;
}
const sharedHeaders = (term: TermResolver) => ["ID", "Title", term("crm.contact.singular", "Customer"), "Salesperson", "Sales team", "Source"]
const extensionHeaders = (extension: CrmExportFields | undefined, term: TermResolver) => (extension?.headers || []).map((header, i) => extension?.terminologyKeys?.[i] ? term(extension.terminologyKeys[i], header) : header)
const sharedValues = (row: SalesRow) => [row.id, row.title, row.contact.name, row.assignee.name, row.salesTeam?.name, row.source]

// Call only with the service's authorized, bounded export selection. Extension
// columns arrive as data from the same tenant transaction, never path traversal.
export function enquiryCsv({ items, extensionExport: extension, customFieldExport: custom, exportTerms = {} }: ExportPage<EnquiryRow>) {
  const term = createTermResolver(exportTerms)
  return crmCsv([...sharedHeaders(term), ...extensionHeaders(extension, term), "Status", "Target close", "Created (UTC)", "Lost reason", "Closing note", ...(custom?.headers || [])],
    items.map(row => [...sharedValues(row), ...(extension?.values[row.id] || []), row.status === "CLOSED" ? "Lost" : row.status, row.targetCloseOn?.toISOString().slice(0, 10), row.createdAt, row.lostReasonName, row.outcome, ...(custom?.values[row.id] || [])]))
}
export function opportunityCsv({ items, extensionExport: extension, customFieldExport: custom, exportTerms = {} }: ExportPage<OpportunityRow>) {
  const term = createTermResolver(exportTerms)
  return crmCsv([...sharedHeaders(term), ...extensionHeaders(extension, term), "Pipeline", "Stage", "Outcome", term("crm.opportunity.singular", "Deal value", "{label} value"), "Currency", "Expected close", "Closed (UTC)", "Created (UTC)", "Lost reason", "Closing note", ...(custom?.headers || [])],
    items.map(row => [...sharedValues(row), ...(extension?.values[row.id] || []), row.pipeline.name, row.stage.name, row.stage.kind, row.amount, row.currency, row.expectedCloseOn.toISOString().slice(0, 10), row.closedAt, row.createdAt, row.lostReasonName, row.lossReason, ...(custom?.values[row.id] || [])]))
}
