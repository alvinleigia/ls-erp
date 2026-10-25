import { readJson } from "@/platform/business-api"
import { withCompanyApi } from "@/platform/companies/http"
export const dynamic = "force-dynamic"
type Context = { params: Promise<{ id: string }> }
export function GET(request: Request, { params }: Context) { return withCompanyApi(request, async service => service.getOffice((await params).id)) }
export function PATCH(request: Request, { params }: Context) { return withCompanyApi(request, async service => service.updateOffice((await params).id, await readJson(request))) }
