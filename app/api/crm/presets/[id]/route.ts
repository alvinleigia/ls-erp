import { withCrmApi } from "@/application/crm/http"
export const dynamic = "force-dynamic"
type Context = { params: Promise<{ id: string }> }
export function GET(request: Request, context: Context) { return withCrmApi(request, async service => service.previewPreset((await context.params).id)) }
export function POST(request: Request, context: Context) { return withCrmApi(request, async service => service.applyPreset((await context.params).id, await request.json())) }
