import { readJson } from "@/platform/business-api"
import { withOfficeAccessApi } from "@/platform/companies/office-http"
export const dynamic = "force-dynamic"
export function GET(request: Request) { return withOfficeAccessApi(request, service => service.getOwnContext()) }
export function PATCH(request: Request) { return withOfficeAccessApi(request, async service => service.selectCreationOffice(await readJson(request))) }
