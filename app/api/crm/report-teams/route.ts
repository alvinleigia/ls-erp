import { withCrmApi, queryInput } from "@/application/crm/http"
export const dynamic = "force-dynamic"
export function GET(request: Request) { return withCrmApi(request, service => service.listReportTeams(queryInput(request))) }
