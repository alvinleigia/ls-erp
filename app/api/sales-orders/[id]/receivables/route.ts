import { z } from "zod"
import { withReceivablesApi } from "@/application/receivables/http"
import { readJson } from "@/platform/business-api"
type Context = { params: Promise<{ id: string }> }
export const GET = (request: Request, context: Context) => withReceivablesApi(request, async service => service.get((await context.params).id, z.coerce.number().int().min(1).max(100000).parse(new URL(request.url).searchParams.get("page") || 1)))
export const POST = (request: Request, context: Context) => withReceivablesApi(request, async service => service.open((await context.params).id, await readJson(request)))
