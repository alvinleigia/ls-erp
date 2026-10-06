import { withCrmApi, queryInput } from "@/application/crm/http"
import { readJson } from "@/platform/business-api"
import { z } from "zod"
export const maxDuration = 60
type Context = { params: Promise<{ id: string }> }
export async function GET(request: Request, context: Context) {
  const { id } = await context.params
  return withCrmApi(request, service => service.getEnquiryImport(id, queryInput(request)))
}
export async function PUT(request: Request, context: Context) {
  const { id } = await context.params
  return withCrmApi(request, async service => service.configureEnquiryImport(id, await readJson(request)))
}
export async function POST(request: Request, context: Context) {
  const { id } = await context.params
  return withCrmApi(request, async service => {
    const { action } = z.object({ action: z.enum(["validate", "import"]) }).strict().parse(await readJson(request))
    return service.processEnquiryImport(id, action)
  })
}
