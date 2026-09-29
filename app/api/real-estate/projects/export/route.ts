import { withRealEstateApi } from "@/modules/real-estate/http"
import { crmCsv } from "@/modules/crm/csv"
import { csvResponse } from "@/modules/crm/csv-response"
export const dynamic = "force-dynamic"
export function GET(request: Request) {
  return withRealEstateApi(request, async service => {
    const { items, customFieldExport: fields } = await service.listProjects(Object.fromEntries(new URL(request.url).searchParams), true)
    return csvResponse(crmCsv(["ID", "Project", "Code", "Location", "Sales lifecycle", ...(fields?.headers ?? [])], items.map(row => [row.id, row.name, row.code, row.location, row.lifecycleName, ...(fields?.values[row.id] ?? [])])), "projects.csv")
  })
}
