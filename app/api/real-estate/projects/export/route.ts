import { createTermResolver } from "@/platform/terminology/resolver"
import { withRealEstateApi } from "@/modules/real-estate/http"
import { crmCsv } from "@/modules/crm/csv"
import { csvResponse } from "@/modules/crm/csv-response"
export const dynamic = "force-dynamic"
export function GET(request: Request) {
  return withRealEstateApi(request, async service => {
    const { items, customFieldExport: fields, exportTerms } = await service.listProjects(Object.fromEntries(new URL(request.url).searchParams), true)
    const term = createTermResolver(exportTerms || {})
    return csvResponse(crmCsv(["ID", term("realEstate.project.singular", "Project"), "Code", "Location", "Sales lifecycle", ...(fields?.headers ?? [])], items.map(row => [row.id, row.name, row.code, row.location, row.lifecycleName, ...(fields?.values[row.id] ?? [])])), "projects.csv")
  })
}
