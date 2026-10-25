import { readJson } from "@/platform/business-api"
import { withCompanyApi, structureQuery } from "@/platform/companies/http"
export const dynamic = "force-dynamic"
export function GET(request: Request) { return withCompanyApi(request, service => service.listCompanies(structureQuery(request))) }
export function POST(request: Request) { return withCompanyApi(request, async service => service.createCompany(await readJson(request)), 201) }
