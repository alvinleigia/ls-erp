import { withCrmApi } from "@/application/crm/http"
export const dynamic = "force-dynamic"
export function GET(request: Request) { return withCrmApi(request, service => service.listExtensionChoices("projects", Object.fromEntries(new URL(request.url).searchParams))) }
