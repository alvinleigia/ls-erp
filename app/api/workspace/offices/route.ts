import { withOfficeAccessApi } from "@/platform/companies/office-http"
export const dynamic = "force-dynamic"
export function GET(request: Request) { return withOfficeAccessApi(request, service => service.listOwnOffices(Object.fromEntries(new URL(request.url).searchParams))) }
