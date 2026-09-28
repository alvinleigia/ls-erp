import { withRealEstateApi } from "@/modules/real-estate/http"
import { readJson } from "@/platform/business-api"
export const dynamic = "force-dynamic"
export function GET(request: Request) { return withRealEstateApi(request, service => service.listProjects(Object.fromEntries(new URL(request.url).searchParams))) }
export function POST(request: Request) { return withRealEstateApi(request, async service => service.createProject(await readJson(request)), 201) }
