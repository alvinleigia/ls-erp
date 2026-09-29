import { withCrmApi, queryInput } from "@/application/crm/http"
import { readJson } from "@/platform/business-api"
export const dynamic = "force-dynamic"
export const GET = (request: Request) => withCrmApi(request, service => service.listContacts(queryInput(request)))
export const POST = (request: Request) => withCrmApi(request, async service => service.createContact(await readJson(request)), 201)
