import { withCrmApi, queryInput } from "@/application/crm/http"
import { readJson } from "@/platform/business-api"
export const dynamic = "force-dynamic"
export const GET = (request: Request) => withCrmApi(request, service => service.listOpportunities(queryInput(request)))
export const POST = (request: Request) => withCrmApi(request, async service => service.createOpportunity(await readJson(request)), 201)
