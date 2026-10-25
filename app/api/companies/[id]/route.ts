import { readJson } from "@/platform/business-api"
import { withCompanyApi } from "@/platform/companies/http"
export const dynamic = "force-dynamic"
type Context = { params: Promise<{ id: string }> }
export function GET(request: Request, { params }: Context) { return withCompanyApi(request, async service => service.getCompany((await params).id)) }
export function PATCH(request: Request, { params }: Context) { return withCompanyApi(request, async service => service.updateCompany((await params).id, await readJson(request))) }
