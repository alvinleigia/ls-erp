import { withCrmApi, queryInput } from "@/modules/crm/http"
import { csvResponse } from "@/modules/crm/csv-response"
import { crmCsv } from "@/modules/crm/csv"
export async function GET(request: Request) {
  return withCrmApi(request, async service => {
    const { items, realEstateEnabled: property } = await service.listOpportunities(queryInput(request), true)
    return csvResponse(crmCsv(["ID", "Title", "Customer", "Salesperson", "Source", ...(property ? ["Project", "Subproject"] : []), "Pipeline", "Stage", "Outcome", "Deal value", "Currency", "Expected close", "Closed (UTC)", "Created (UTC)"], items.map(r => [r.id, r.title, r.contact.name, r.assignee.name, r.source, ...(property ? [r.propertyContext?.project?.name, r.propertyContext?.subproject?.name] : []), r.pipeline.name, r.stage.name, r.stage.kind, r.amount, r.currency, r.expectedCloseOn.toISOString().slice(0, 10), r.closedAt, r.createdAt])), "opportunities.csv")
  })
}
