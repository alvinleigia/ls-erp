import { withCustomFieldApi } from "@/application/crm/custom-fields"
import { readJson } from "@/platform/business-api"
export const dynamic = "force-dynamic"
export function GET(request: Request) { return withCustomFieldApi(request, service => service.list(Object.fromEntries(new URL(request.url).searchParams))) }
export function POST(request: Request) { return withCustomFieldApi(request, async service => service.save(await readJson(request)), 201) }
