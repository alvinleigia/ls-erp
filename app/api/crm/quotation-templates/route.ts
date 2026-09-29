import { withCrmApi, queryInput } from "@/application/crm/http"
import { readJson } from "@/platform/business-api"
export const GET = (request: Request) => withCrmApi(request, service => service.listQuotationTemplates(queryInput(request)))
export const POST = (request: Request) => withCrmApi(request, async service => service.saveQuotationTemplate(await readJson(request)), 201)
