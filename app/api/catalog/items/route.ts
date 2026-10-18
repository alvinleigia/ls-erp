import { withCatalogApi } from "@/application/catalog/http"
import { readJson } from "@/platform/business-api"
export const GET = (request: Request) => withCatalogApi(request, service => service.list(Object.fromEntries(new URL(request.url).searchParams)))
export const POST = (request: Request) => withCatalogApi(request, async service => service.save(await readJson(request)), 201)
