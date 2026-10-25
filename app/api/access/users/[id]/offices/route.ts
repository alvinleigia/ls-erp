import { readJson } from "@/platform/business-api"
import { withOfficeAccessApi } from "@/platform/companies/office-http"
export const dynamic = "force-dynamic"
type Context = { params: Promise<{ id: string }> }
export function GET(request: Request, { params }: Context) { return withOfficeAccessApi(request, async service => service.getMemberships((await params).id)) }
export function PATCH(request: Request, { params }: Context) { return withOfficeAccessApi(request, async service => service.saveMemberships((await params).id, await readJson(request))) }
