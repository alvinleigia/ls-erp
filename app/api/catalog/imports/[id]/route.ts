import { z } from "zod"
import { withCatalogApi } from "@/application/catalog/http"
import { readJson } from "@/platform/business-api"
type Context = { params: Promise<{ id: string }> }
export const runtime = "nodejs"
export const maxDuration = 60
export const GET = (request: Request, context: Context) => withCatalogApi(request, async service => service.getCatalogImport((await context.params).id, Object.fromEntries(new URL(request.url).searchParams)))
export const POST = (request: Request, context: Context) => withCatalogApi(request, async service => {
  const { action } = z.object({ action: z.enum(["validate", "import"]) }).strict().parse(await readJson(request))
  return service.processCatalogImport((await context.params).id, action)
})
