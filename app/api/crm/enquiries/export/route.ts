import { withCrmApi, queryInput } from "@/application/crm/http"
import { csvResponse } from "@/modules/crm/csv-response"
import { crmCsv } from "@/modules/crm/csv"
export async function GET(request: Request) {
  return withCrmApi(request, async service => {
    const { customFieldExport: fields, items, realEstateEnabled: property } = await service.listEnquiries(queryInput(request), true)
    return csvResponse(crmCsv(["ID", "Title", "Customer", "Salesperson", "Sales team", "Source", ...(property ? ["Project", "Subproject"] : []), "Status", "Target close", "Created (UTC)", "Lost reason", "Closing note", ...(fields?.headers ?? [])], items.map(r => [r.id, r.title, r.contact.name, r.assignee.name, r.salesTeam?.name, r.source, ...(property ? [r.propertyContext?.project?.name, r.propertyContext?.subproject?.name] : []), r.status === "CLOSED" ? "Lost" : r.status, r.targetCloseOn?.toISOString().slice(0, 10), r.createdAt, r.lostReasonName, r.outcome, ...(fields?.values[r.id] ?? [])])), "enquiries.csv")
  })
}
