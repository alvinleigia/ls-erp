import { z } from "zod"
import { withReservationsApi } from "@/application/catalog/reservations-http"
import { readJson } from "@/platform/business-api"
type Context = { params: Promise<{ id: string }> }
export const GET = (request: Request, context: Context) => withReservationsApi(request, async service => {
  const { id } = await context.params
  const page = z.coerce.number().int().min(1).max(100000).parse(new URL(request.url).searchParams.get("page") || 1)
  return { ...await service.list(id), ...await service.history(id, page) }
})
export const POST = (request: Request, context: Context) => withReservationsApi(request, async service => service.create((await context.params).id, await readJson(request)))
