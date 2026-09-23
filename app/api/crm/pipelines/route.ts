import { withCrmApi, queryInput } from "@/modules/crm/http"
import { readJson } from "@/platform/business-api"
export const dynamic = "force-dynamic"
export const GET = (request: Request) => withCrmApi(request, service => service.listPipelines(queryInput(request)))
export const POST = (request: Request) => withCrmApi(request, async service => service.createPipeline(await readJson(request)), 201)
