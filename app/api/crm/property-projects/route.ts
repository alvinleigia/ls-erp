import { withCrmApi } from "@/modules/crm/http"
export const dynamic = "force-dynamic"
export function GET(request: Request) { return withCrmApi(request, service => service.listProjectFilterChoices(Object.fromEntries(new URL(request.url).searchParams))) }
