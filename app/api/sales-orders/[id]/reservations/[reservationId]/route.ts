import { withReservationsApi } from "@/application/catalog/reservations-http"
import { readJson } from "@/platform/business-api"
export const PATCH = (request: Request, context: { params: Promise<{ id: string; reservationId: string }> }) => withReservationsApi(request, async service => {
  const { id, reservationId } = await context.params
  return service.transition(id, reservationId, await readJson(request))
})
