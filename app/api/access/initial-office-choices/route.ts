import { readJson } from "@/platform/business-api"
import { withOfficeAccessApi } from "@/platform/companies/office-http"
export const dynamic = "force-dynamic"

export function POST(request: Request) {
  return withOfficeAccessApi(request, async service => service.initialCreationChoices(await readJson(request)))
}
