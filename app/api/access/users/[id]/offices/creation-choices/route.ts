import { readJson } from "@/platform/business-api"
import { withOfficeAccessApi } from "@/platform/companies/office-http"
export const dynamic = "force-dynamic"

export function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withOfficeAccessApi(request, async service => service.creationChoices((await params).id, await readJson(request)))
}
