import { withCrmApi } from "@/application/crm/http"
export const dynamic = "force-dynamic"
export const GET = (request: Request) => withCrmApi(request, service => service.partnerChoices(Object.fromEntries(new URL(request.url).searchParams)))
