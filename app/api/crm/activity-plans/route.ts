import { withCrmApi, queryInput } from "@/modules/crm/http"
import { readJson } from "@/platform/business-api"
export const dynamic = "force-dynamic"
export const GET = (request: Request) => withCrmApi(request, service => service.listActivityPlans(queryInput(request)))
export const POST = (request: Request) => withCrmApi(request, async service => service.createActivityPlan(await readJson(request)), 201)
